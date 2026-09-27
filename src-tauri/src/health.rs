//! Weak and reused passwords, decided in memory. The report has ids, titles, domains,
//! and issue kinds. Passwords, scores, and zxcvbn feedback stay here.

use std::cmp::Ordering;
use std::collections::HashSet;

use serde::Serialize;
use zeroize::Zeroizing;
use zxcvbn::zxcvbn;

/// One decrypted login, including its current password. Not sent to the UI.
pub(crate) struct CheckedLogin {
    pub id: String,
    pub title: String,
    pub username: String,
    pub domain: String,
    pub password: Zeroizing<String>,
    pub deleted: bool,
}

/// Counts and the fix list. No password, hash, or score.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultHealth {
    pub strong: u32,
    pub weak: u32,
    pub reused: u32,
    pub issues: Vec<HealthIssue>,
}

/// One card on the fix list. A reused card holds every login that shares a password.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthIssue {
    pub kind: HealthKind,
    pub entries: Vec<HealthLogin>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HealthKind {
    Weak,
    Reused,
}

/// A login on a card. `weak` is true when that login's own score is 0–2, so a reused
/// card can mark the weak members without giving them a second card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthLogin {
    pub id: String,
    pub title: String,
    pub domain: String,
    pub weak: bool,
}

/// Scores current passwords and groups identical ones. Deleted logins are skipped.
/// Password history is not in `entries`, so it cannot form a group.
pub(crate) fn assess(entries: &[CheckedLogin]) -> VaultHealth {
    let live: Vec<&CheckedLogin> = entries.iter().filter(|entry| !entry.deleted).collect();
    let weak_flags: Vec<bool> = live.iter().map(|entry| is_weak(entry)).collect();

    let mut claimed = vec![false; live.len()];
    let mut reused_groups: Vec<Vec<usize>> = Vec::new();
    for i in 0..live.len() {
        if claimed[i] {
            continue;
        }
        let mut members = vec![i];
        for j in (i + 1)..live.len() {
            if !claimed[j] && live[j].password.as_str() == live[i].password.as_str() {
                members.push(j);
                claimed[j] = true;
            }
        }
        claimed[i] = true;
        if members.len() >= 2 {
            reused_groups.push(members);
        }
    }

    let mut reused_set = HashSet::new();
    let mut reused_issues = Vec::new();
    for members in reused_groups {
        let mut logins = Vec::with_capacity(members.len());
        for index in members {
            reused_set.insert(index);
            logins.push(login_from(live[index], weak_flags[index]));
        }
        logins.sort_by(title_then_id);
        reused_issues.push(HealthIssue {
            kind: HealthKind::Reused,
            entries: logins,
        });
    }
    reused_issues.sort_by(|a, b| {
        b.entries
            .len()
            .cmp(&a.entries.len())
            .then_with(|| title_then_id(&a.entries[0], &b.entries[0]))
    });

    let mut weak_issues = Vec::new();
    for (index, entry) in live.iter().enumerate() {
        if weak_flags[index] && !reused_set.contains(&index) {
            weak_issues.push(HealthIssue {
                kind: HealthKind::Weak,
                entries: vec![login_from(entry, true)],
            });
        }
    }
    weak_issues.sort_by(|a, b| title_then_id(&a.entries[0], &b.entries[0]));

    let weak_count = weak_flags.iter().filter(|flag| **flag).count();
    let reused_count = reused_set.len();
    let problem_count = live
        .iter()
        .enumerate()
        .filter(|(index, _)| weak_flags[*index] || reused_set.contains(index))
        .count();

    let mut issues = reused_issues;
    issues.append(&mut weak_issues);
    VaultHealth {
        strong: as_count(live.len() - problem_count),
        weak: as_count(weak_count),
        reused: as_count(reused_count),
        issues,
    }
}

fn login_from(entry: &CheckedLogin, weak: bool) -> HealthLogin {
    HealthLogin {
        id: entry.id.clone(),
        title: entry.title.clone(),
        domain: entry.domain.clone(),
        weak,
    }
}

fn title_then_id(a: &HealthLogin, b: &HealthLogin) -> Ordering {
    a.title
        .to_lowercase()
        .cmp(&b.title.to_lowercase())
        .then(a.id.cmp(&b.id))
}

fn as_count(count: usize) -> u32 {
    u32::try_from(count).unwrap_or(u32::MAX)
}

/// zxcvbn score 0–2. Title, username, and domain are extra dictionary words, plus each
/// alphanumeric run of 3 or more, because this zxcvbn build does not split on punctuation.
/// An input such as `discord.com` would otherwise miss `discord123`.
fn is_weak(entry: &CheckedLogin) -> bool {
    if entry.password.is_empty() {
        return true;
    }
    let words = dictionary_words(&entry.title, &entry.username, &entry.domain);
    let refs: Vec<&str> = words.iter().map(String::as_str).collect();
    let entropy = zxcvbn(entry.password.as_str(), &refs);
    u8::from(entropy.score()) <= 2
}

fn dictionary_words(title: &str, username: &str, domain: &str) -> Vec<String> {
    let mut words = Vec::new();
    for field in [title, username, domain] {
        let trimmed = field.trim();
        if trimmed.is_empty() {
            continue;
        }
        words.push(trimmed.to_string());
        let mut run = String::new();
        for ch in trimmed.chars() {
            if ch.is_alphanumeric() {
                run.push(ch);
            } else if !run.is_empty() {
                push_run(&mut words, &mut run);
            }
        }
        if !run.is_empty() {
            push_run(&mut words, &mut run);
        }
    }
    words
}

fn push_run(words: &mut Vec<String>, run: &mut String) {
    if run.chars().count() >= 3 {
        words.push(std::mem::take(run).to_lowercase());
    } else {
        run.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const STRONG: &str = "r8#Qm4-vL2!pX7$eN3&k";
    const UNIQUE: &str = "Zt4!qL9#wP2$eM7^nR5&";

    fn login(
        id: &str,
        title: &str,
        username: &str,
        domain: &str,
        password: &str,
        deleted: bool,
    ) -> CheckedLogin {
        CheckedLogin {
            id: id.to_string(),
            title: title.to_string(),
            username: username.to_string(),
            domain: domain.to_string(),
            password: Zeroizing::new(password.to_string()),
            deleted,
        }
    }

    #[test]
    fn weak_reused_and_deleted_logins_become_cards_without_secrets() {
        let entries = vec![
            login("a1", "Alpha", "ada", "alpha.example", "password", false),
            login("a3", "Gamma", "gia", "gamma.example", "password", false),
            login("a2", "Beta", "ben", "beta.example", "password", false),
            login("b2", "Epsilon", "eli", "epsilon.example", STRONG, false),
            login("b1", "Delta", "dee", "delta.example", STRONG, false),
            login("c1", "Work", "ada", "discord.com", "discord123", false),
            login("d1", "Gone", "gus", "gone.example", "password", true),
            login("e1", "Solo", "sam", "solo.example", UNIQUE, false),
            login("f1", "Blank", "bri", "blank.example", "", false),
        ];
        let health = assess(&entries);
        let json = serde_json::to_string(&health).unwrap();
        assert!(!json.contains("password"));
        assert!(!json.contains("discord123"));
        assert!(!json.contains(STRONG));
        assert!(!json.contains(UNIQUE));
        assert!(!json.contains("score"));
        assert!(!json.contains("guesses"));
        assert!(!json.contains("warning"));
        assert!(!json.contains("feedback"));
        assert!(!json.contains("Gone"));

        assert_eq!(health.reused, 5);
        assert_eq!(health.weak, 5);
        assert_eq!(health.strong, 1);
        assert_eq!(health.issues.len(), 4);

        assert_eq!(health.issues[0].kind, HealthKind::Reused);
        assert_eq!(
            health.issues[0]
                .entries
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            vec!["a1", "a2", "a3"]
        );
        assert!(health.issues[0].entries.iter().all(|entry| entry.weak));

        assert_eq!(health.issues[1].kind, HealthKind::Reused);
        assert_eq!(health.issues[1].entries.len(), 2);
        assert!(health.issues[1].entries.iter().all(|entry| !entry.weak));

        assert_eq!(health.issues[2].kind, HealthKind::Weak);
        assert_eq!(health.issues[2].entries[0].id, "f1");
        assert_eq!(health.issues[3].kind, HealthKind::Weak);
        assert_eq!(health.issues[3].entries[0].id, "c1");
        assert_eq!(health.issues[3].entries[0].domain, "discord.com");

        let weak_ids: Vec<&str> = health
            .issues
            .iter()
            .filter(|issue| issue.kind == HealthKind::Weak)
            .flat_map(|issue| issue.entries.iter().map(|entry| entry.id.as_str()))
            .collect();
        assert!(!weak_ids.contains(&"a1"));
        assert!(!weak_ids.contains(&"a2"));
        assert!(!weak_ids.contains(&"a3"));
    }

    #[test]
    fn discord_in_the_domain_makes_discord123_weak() {
        let entry = login(
            "1",
            "Work",
            "ada@example.com",
            "discord.com",
            "discord123",
            false,
        );
        assert!(is_weak(&entry));
        let unrelated = login("2", "Work", "ada@example.com", "example.com", STRONG, false);
        assert!(!is_weak(&unrelated));
    }
}

//! CSV import. Passwords stay in these values until the vault stores them.
//! Errors from this module never include file contents.

use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::error::{Result, VaultError};

const MAX_IMPORT_BYTES: usize = 8 * 1024 * 1024;
const MAX_IMPORT_ROWS: usize = 5_000;

const COLUMNS: [&str; 5] = ["title", "username", "password", "url", "notes"];

/// One login read from a CSV row. Wiped when dropped.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct CsvLogin {
    pub title: String,
    pub username: String,
    pub password: String,
    pub url: String,
    pub notes: String,
}

pub struct ParsedCsv {
    pub logins: Vec<CsvLogin>,
    pub skipped: u32,
}

/// Reads a CSV whose first row names `title`, `username`, `password`, `url`, and `notes`.
/// Rows that are too wide or too short are skipped. A file that is not that CSV is refused
/// without quoting any of its contents.
pub fn parse_csv(bytes: &[u8]) -> Result<ParsedCsv> {
    if bytes.len() > MAX_IMPORT_BYTES {
        return Err(VaultError::ImportRefused);
    }
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    let text = std::str::from_utf8(bytes).map_err(|_| VaultError::ImportRefused)?;
    let rows = split_csv(text).map_err(|_| VaultError::ImportRefused)?;
    let mut rows = rows.into_iter();
    let header = rows.next().ok_or(VaultError::ImportRefused)?;
    let indexes = column_indexes(&header)?;

    let mut logins = Vec::new();
    let mut skipped = 0u32;
    for row in rows {
        if logins.len() + skipped as usize >= MAX_IMPORT_ROWS {
            return Err(VaultError::ImportRefused);
        }
        if row.iter().all(|field| field.trim().is_empty()) {
            continue;
        }
        if row.len() != header.len() {
            skipped += 1;
            continue;
        }
        logins.push(CsvLogin {
            title: row[indexes[0]].trim().to_string(),
            username: row[indexes[1]].trim().to_string(),
            password: row[indexes[2]].trim().to_string(),
            url: row[indexes[3]].trim().to_string(),
            notes: row[indexes[4]].trim().to_string(),
        });
    }
    Ok(ParsedCsv { logins, skipped })
}

fn column_indexes(header: &[String]) -> Result<[usize; 5]> {
    let mut indexes = [None; 5];
    for (position, name) in header.iter().enumerate() {
        let name = name.trim();
        if let Some(slot) = COLUMNS
            .iter()
            .position(|column| name.eq_ignore_ascii_case(column))
        {
            if indexes[slot].is_some() {
                return Err(VaultError::ImportRefused);
            }
            indexes[slot] = Some(position);
        }
    }
    let mut found = [0; 5];
    for (slot, index) in indexes.into_iter().enumerate() {
        found[slot] = index.ok_or(VaultError::ImportRefused)?;
    }
    Ok(found)
}

/// RFC 4180-style split. A quoted field may contain commas and line breaks.
fn split_csv(text: &str) -> std::result::Result<Vec<Vec<String>>, ()> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if in_quotes {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(ch);
            }
            continue;
        }
        match ch {
            '"' if field.is_empty() => in_quotes = true,
            ',' => row.push(std::mem::take(&mut field)),
            '\n' => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            '\r' => {}
            _ => field.push(ch),
        }
    }
    if in_quotes {
        return Err(());
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    if rows.is_empty() {
        return Err(());
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoted_password_with_a_comma_stays_one_field() {
        let csv =
            "title,username,password,url,notes\nBank,ada,\"one,two\",https://bank.example,note\n";
        let parsed = parse_csv(csv.as_bytes()).unwrap();
        assert_eq!(parsed.skipped, 0);
        assert_eq!(parsed.logins.len(), 1);
        assert_eq!(parsed.logins[0].password, "one,two");
        assert_eq!(parsed.logins[0].title, "Bank");
    }

    #[test]
    fn a_file_without_the_password_column_is_refused() {
        let csv = "title,username,url,notes\nBank,ada,https://bank.example,note\n";
        assert!(matches!(
            parse_csv(csv.as_bytes()),
            Err(VaultError::ImportRefused)
        ));
    }
}

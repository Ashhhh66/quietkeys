import { avatarColors, avatarLetter } from "../avatar";
import { useTheme } from "../theme";

const SIZES = {
  sm: "size-[38px] rounded-[10px] text-[16px]",
  lg: "size-[60px] rounded-2xl text-[26px]",
} as const;

export default function Avatar({
  title,
  url,
  size = "sm",
}: {
  title: string;
  url: string;
  size?: keyof typeof SIZES;
}) {
  const colors = avatarColors(title, url, useTheme());
  return (
    <span
      aria-hidden
      style={{ backgroundColor: colors.bg, color: colors.fg }}
      className={`flex shrink-0 items-center justify-center leading-none font-bold ${SIZES[size]}`}
    >
      {avatarLetter(title)}
    </span>
  );
}

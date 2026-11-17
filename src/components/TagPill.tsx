// 统一标签胶囊：卡片 / 筛选条 / 详情页 / 上传队列 / 选择弹窗共用同一套外观
// 淡蓝底 + 蓝字，选中时填成实心蓝；只有这一个地方定义标签长什么样
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const SIZE = {
  sm: "px-2 py-0.5 text-[11px] leading-5 gap-1",
  md: "px-3 py-1 text-xs leading-5 gap-1.5",
} as const;

const TONE_IDLE = "border-film/25 bg-film/10 text-film";
const TONE_ACTIVE =
  "border-film bg-film text-primary-foreground shadow-[0_4px_14px_-4px_oklch(0.52_0.16_258_/_0.5)]";

export function tagPillClass(
  { active = false, size = "sm" }: { active?: boolean; size?: keyof typeof SIZE } = {},
  extra?: string,
) {
  return cn(
    "inline-flex max-w-full items-center rounded-full border font-medium transition-colors",
    SIZE[size],
    active ? TONE_ACTIVE : TONE_IDLE,
    extra,
  );
}

/** 只读展示：卡片、上传队列 */
export function TagPill({
  name,
  count,
  size = "sm",
  className,
  title,
}: {
  name: string;
  count?: number;
  size?: keyof typeof SIZE;
  className?: string;
  title?: string;
}) {
  return (
    <span className={tagPillClass({ size }, cn("shrink-0", className))} title={title}>
      <span className="truncate">#{name}</span>
      {typeof count === "number" && (
        <span className="shrink-0 tabular-nums opacity-60">{count}</span>
      )}
    </span>
  );
}

/** 带 × 的展示：详情页 */
export function RemovableTagPill({
  name,
  size = "md",
  onRemove,
}: {
  name: string;
  size?: keyof typeof SIZE;
  onRemove: () => void;
}) {
  return (
    <span className={tagPillClass({ size }, "shrink-0 pr-1")}>
      <span className="truncate">#{name}</span>
      <button
        type="button"
        aria-label={`移除标签${name}`}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-film/70 transition-colors hover:bg-film/15 hover:text-film"
        onClick={onRemove}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

/** 可点击选择：筛选条、勾选弹窗 */
export function TagPillButton({
  name,
  count,
  active = false,
  size = "md",
  onClick,
  className,
  leading,
  ...rest
}: {
  name: string;
  count?: number;
  active?: boolean;
  size?: keyof typeof SIZE;
  onClick: () => void;
  className?: string;
  leading?: ReactNode;
  "aria-label"?: string;
  "aria-pressed"?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={tagPillClass({ active, size }, cn("shrink-0 whitespace-nowrap", className))}
      {...rest}
    >
      {leading}
      <span className="truncate">#{name}</span>
      {typeof count === "number" && (
        <span className={cn("shrink-0 tabular-nums", active ? "opacity-80" : "opacity-50")}>
          {count}
        </span>
      )}
    </button>
  );
}

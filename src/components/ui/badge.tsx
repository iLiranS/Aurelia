import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-ring select-none",
  {
    variants: {
      variant: {
        default:
          "border-white/[0.10] bg-white/[0.06] text-zinc-300 backdrop-blur-sm shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]",
        secondary:
          "border-white/[0.08] bg-white/[0.04] text-zinc-400 backdrop-blur-sm",
        primary:
          "border-primary/40 bg-primary/15 text-primary shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)]",
        accent:
          "border-primary/40 bg-primary/15 text-primary shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)]",
        gold:
          "border-primary/40 bg-primary/15 text-primary shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)]",
        blue:
          "border-[#60a5fa]/40 bg-[#60a5fa]/15 text-[#60a5fa] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)]",
        outline:
          "border-white/[0.10] bg-transparent text-zinc-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-xs font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 select-none cursor-pointer active:scale-[0.96]",
  {
    variants: {
      variant: {
        default:
          "liquid-glass-btn text-zinc-200 hover:text-white",
        primary:
          "liquid-glass-accent text-primary font-semibold",
        accent:
          "liquid-glass-accent text-primary font-semibold",
        solid:
          "bg-primary text-primary-foreground font-semibold hover:opacity-90 shadow-md",
        secondary:
          "liquid-glass-btn text-zinc-300 hover:text-white",
        destructive:
          "bg-gradient-to-b from-red-500/25 to-red-500/12 text-red-100 hover:from-red-500/35 hover:to-red-500/18 border border-red-400/35 backdrop-blur-md shadow-[inset_0_1px_1px_rgba(255,255,255,0.32),inset_0_-1px_1px_rgba(239,68,68,0.28)]",
        outline:
          "border border-white/[0.14] bg-white/[0.02] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-100 hover:border-white/[0.24]",
        ghost:
          "border border-transparent hover:border-white/[0.14] hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-100 active:bg-white/[0.13]",
        glass:
          "liquid-glass-btn text-zinc-300 hover:text-zinc-100",
        link:
          "text-primary underline-offset-4 hover:underline border-0",
      },
      size: {
        default: "h-8 px-3 py-1.5",
        sm: "h-7 rounded-lg px-2.5 text-[11px]",
        lg: "h-9 rounded-xl px-4 text-sm",
        icon: "h-8 w-8 rounded-xl",
        "icon-sm": "h-7 w-7 rounded-lg",
        "icon-xs": "h-6 w-6 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  active?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, active = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const activeClass = active
      ? variant === "accent" || variant === "primary"
        ? "liquid-glass-accent text-primary font-semibold"
        : variant === "solid"
        ? "bg-primary text-primary-foreground font-semibold"
        : "liquid-glass-active text-white font-semibold"
      : undefined;

    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), activeClass, className)}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };

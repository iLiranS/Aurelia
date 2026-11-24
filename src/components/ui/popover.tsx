import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/useThemeStore";

const Popover: React.FC<React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>> = ({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  ...props
}) => {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const performanceMode = useThemeStore((s) => s.performanceMode);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange]
  );

  // Automatically close any open popover when entering focus / performance mode
  React.useEffect(() => {
    if (performanceMode && open) {
      handleOpenChange(false);
    }
  }, [performanceMode, open, handleOpenChange]);

  return (
    <PopoverPrimitive.Root
      open={performanceMode ? false : open}
      onOpenChange={handleOpenChange}
      {...props}
    />
  );
};

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 8, onCloseAutoFocus, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      onCloseAutoFocus={(e) => {
        if (useThemeStore.getState().performanceMode) {
          e.preventDefault();
        }
        onCloseAutoFocus?.(e);
      }}
      className={cn(
        "z-50 w-72 rounded-2xl liquid-glass-popover p-3.5 text-zinc-100 outline-none origin-[var(--radix-popover-content-transform-origin)] animate-in fade-in-0 zoom-in-95 duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-150 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };

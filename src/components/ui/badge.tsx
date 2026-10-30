import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-foreground text-background",
        lime: "border-transparent bg-primary text-primary-foreground",
        success: "border-transparent bg-success-surface text-success-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
        outline: "text-foreground",
        warning: "border-transparent bg-warning-surface text-warning",
        destructive: "border-transparent bg-destructive-surface text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

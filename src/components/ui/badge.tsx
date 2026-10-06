import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      default: 'bg-primary/15 text-primary-strong',
      secondary: 'bg-muted text-muted-foreground',
      success: 'bg-success/15 text-success-strong',
      warning: 'bg-warning/20 text-warning-strong',
      destructive: 'bg-destructive/15 text-destructive',
      info: 'bg-info/15 text-info-strong',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

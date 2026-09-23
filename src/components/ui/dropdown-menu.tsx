"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as React from "react";
import { cn } from "@/lib/utils";

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuContent = React.forwardRef<React.ElementRef<typeof DropdownMenuPrimitive.Content>, React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>>(({ className, sideOffset = 6, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn("z-50 min-w-[10rem] overflow-hidden rounded-md border bg-card p-1 text-card-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0", className)}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

const DropdownMenuItem = React.forwardRef<React.ElementRef<typeof DropdownMenuPrimitive.Item>, React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Item ref={ref} className={cn("relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50", className)} {...props} />
));
DropdownMenuItem.displayName = "DropdownMenuItem";

const DropdownMenuLabel = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("px-2.5 py-1.5 text-xs font-semibold text-muted-foreground", className)} {...props} />;

export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger };

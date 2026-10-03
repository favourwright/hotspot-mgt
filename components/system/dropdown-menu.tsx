import {
  DropdownMenu as BaseDropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * `modal={false}` by default.
 *
 * Base UI's menu is modal out of the box, which locks document scroll while
 * it's open. Removing the scrollbar narrows the viewport, so everything
 * behind the menu shifts sideways the moment it opens -- very visible on a
 * dropdown that sits inside a scrollable dialog. None of our menus need to
 * trap interaction; dismiss-on-outside-click works either way.
 */
export function DropdownMenu({
  modal = false,
  ...props
}: React.ComponentProps<typeof BaseDropdownMenu>) {
  return <BaseDropdownMenu modal={modal} {...props} />;
}

export {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
};

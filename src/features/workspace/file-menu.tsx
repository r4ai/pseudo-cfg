"use client";

import { ChevronDownIcon, FilePlusIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { byRecency, type SavedFile } from "./files";

type FileMenuProps = {
  files: SavedFile[];
  active: SavedFile;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (file: SavedFile) => void;
};

/** The open file's name, with a menu to switch between, create, rename and delete files. */
export function FileMenu({ files, active, onOpen, onCreate, onRename, onDelete }: FileMenuProps) {
  const [renaming, setRenaming] = useState(false);

  if (renaming) {
    const commit = (name: string) => {
      setRenaming(false);
      if (name.trim()) onRename(active.id, name.trim());
    };
    return (
      <input
        aria-label="File name"
        defaultValue={active.name}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the user just asked to rename it
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit(event.currentTarget.value);
          if (event.key !== "Escape") return;
          // Leaving the name as it was makes the blur that may follow a no-op.
          event.currentTarget.value = active.name;
          setRenaming(false);
        }}
        className="h-6 w-40 min-w-0 rounded-md border bg-background px-1.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="xs" className="-ml-1.5 min-w-0" />}>
        <span className="truncate">{active.name}</span>
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Saved in this browser</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={active.id} onValueChange={(id: string) => onOpen(id)}>
            {byRecency(files).map((file) => (
              <DropdownMenuRadioItem key={file.id} value={file.id}>
                <span className="truncate">{file.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onCreate}>
            <FilePlusIcon />
            New file
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(active)}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

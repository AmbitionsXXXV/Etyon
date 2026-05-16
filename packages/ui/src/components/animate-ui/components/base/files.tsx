import {
  Files as FilesPrimitive,
  FilesHighlight as FilesHighlightPrimitive,
  FolderItem as FolderItemPrimitive,
  FolderHeader as FolderHeaderPrimitive,
  FolderTrigger as FolderTriggerPrimitive,
  FolderHighlight as FolderHighlightPrimitive,
  Folder as FolderPrimitive,
  FolderIcon as FolderIconPrimitive,
  FileLabel as FileLabelPrimitive,
  FolderPanel as FolderPanelPrimitive,
  FileHighlight as FileHighlightPrimitive,
  File as FilePrimitive,
  FileIcon as FileIconPrimitive
} from "@etyon/ui/components/animate-ui/primitives/base/files"
import type {
  FilesProps as FilesPrimitiveProps,
  FileProps as FilePrimitiveProps,
  FileLabelProps as FileLabelPrimitiveProps,
  FolderItemProps as FolderItemPrimitiveProps,
  FolderPanelProps as FolderPanelPrimitiveProps
} from "@etyon/ui/components/animate-ui/primitives/base/files"
import { cn } from "@etyon/ui/lib/utils"
import {
  File01Icon,
  Folder01Icon,
  FolderOpenIcon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import * as React from "react"

type GitStatus = "untracked" | "modified" | "deleted"

type FilesProps = FilesPrimitiveProps

const DefaultFileIcon = ({ className }: { className?: string }) => (
  <HugeiconsIcon className={className} icon={File01Icon} />
)

function Files({ className, children, ...props }: FilesProps) {
  return (
    <FilesPrimitive className={cn("p-2 w-full", className)} {...props}>
      <FilesHighlightPrimitive className="pointer-events-none rounded-lg bg-accent">
        {children}
      </FilesHighlightPrimitive>
    </FilesPrimitive>
  )
}

type SubFilesProps = FilesProps

function SubFiles(props: SubFilesProps) {
  return <FilesPrimitive {...props} />
}

type FolderItemProps = FolderItemPrimitiveProps

function FolderItem(props: FolderItemProps) {
  return <FolderItemPrimitive {...props} />
}

type FolderTriggerProps = FileLabelPrimitiveProps & {
  gitStatus?: GitStatus
}

function FolderTrigger({
  children,
  className,
  gitStatus,
  ...props
}: FolderTriggerProps) {
  return (
    <FolderHeaderPrimitive>
      <FolderTriggerPrimitive className="w-full text-start">
        <FolderHighlightPrimitive>
          <FolderPrimitive className="pointer-events-none flex items-center justify-between gap-2 p-2">
            <div
              className={cn(
                "flex items-center gap-2",
                gitStatus === "untracked" && "text-green-400",
                gitStatus === "modified" && "text-amber-400",
                gitStatus === "deleted" && "text-red-400"
              )}
            >
              <FolderIconPrimitive
                closeIcon={
                  <HugeiconsIcon className="size-4.5" icon={Folder01Icon} />
                }
                openIcon={
                  <HugeiconsIcon className="size-4.5" icon={FolderOpenIcon} />
                }
              />
              <FileLabelPrimitive
                className={cn("text-sm", className)}
                {...props}
              >
                {children}
              </FileLabelPrimitive>
            </div>

            {gitStatus && (
              <span
                className={cn(
                  "rounded-full size-2",
                  gitStatus === "untracked" && "bg-green-400",
                  gitStatus === "modified" && "bg-amber-400",
                  gitStatus === "deleted" && "bg-red-400"
                )}
              />
            )}
          </FolderPrimitive>
        </FolderHighlightPrimitive>
      </FolderTriggerPrimitive>
    </FolderHeaderPrimitive>
  )
}

type FolderPanelProps = FolderPanelPrimitiveProps

function FolderPanel(props: FolderPanelProps) {
  return (
    <div className="relative ml-6 before:absolute before:inset-y-0 before:-left-2 before:h-full before:w-px before:bg-border">
      <FolderPanelPrimitive {...props} />
    </div>
  )
}

type FileItemProps = FilePrimitiveProps & {
  icon?: React.ElementType
  gitStatus?: GitStatus
}

function FileItem({
  icon: Icon = DefaultFileIcon,
  className,
  children,
  gitStatus,
  ...props
}: FileItemProps) {
  return (
    <FileHighlightPrimitive>
      <FilePrimitive
        className={cn(
          "flex items-center justify-between gap-2 p-2 pointer-events-none",
          gitStatus === "untracked" && "text-green-400",
          gitStatus === "modified" && "text-amber-400",
          gitStatus === "deleted" && "text-red-400"
        )}
      >
        <div className="flex items-center gap-2">
          <FileIconPrimitive>
            <Icon className="size-4.5" />
          </FileIconPrimitive>
          <FileLabelPrimitive className={cn("text-sm", className)} {...props}>
            {children}
          </FileLabelPrimitive>
        </div>

        {gitStatus && (
          <span className="text-sm font-medium">
            {gitStatus === "untracked" && "U"}
            {gitStatus === "modified" && "M"}
            {gitStatus === "deleted" && "D"}
          </span>
        )}
      </FilePrimitive>
    </FileHighlightPrimitive>
  )
}

export {
  Files,
  FolderItem,
  FolderTrigger,
  FolderPanel,
  FileItem,
  SubFiles,
  type FilesProps,
  type FolderItemProps,
  type FolderTriggerProps,
  type FolderPanelProps,
  type FileItemProps,
  type SubFilesProps
}

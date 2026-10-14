import React, { useRef, useState } from 'react';
import { Upload as UploadIcon, Image as ImageIcon, Inbox, FolderOpen } from 'lucide-react';
import { Button, Card, CardContent } from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { cn } from '@/lib/utils';

interface UploadAreaProps {
  onUpload: (file: File, fileList: File[]) => Promise<boolean | void>;
  disabled?: boolean;
  /** Slate drop zone without the marketing header/feature list (FG extraction page). */
  compact?: boolean;
  /** compact only: shown instead of the drop hint while `disabled` (e.g. "pick a sub-division first"). */
  disabledHint?: string;
  /** compact only: where the photos will go, e.g. "MENS › MU › M_F_SHIRT_FS". */
  targetLabel?: string;
}

interface FileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
}

interface FileSystemFileEntry extends FileSystemEntry {
  file: (success: (file: File) => void, error?: (err: DOMException) => void) => void;
}

interface FileSystemDirectoryEntry extends FileSystemEntry {
  createReader: () => FileSystemDirectoryReader;
}

interface FileSystemDirectoryReader {
  readEntries: (success: (entries: FileSystemEntry[]) => void, error?: (err: DOMException) => void) => void;
}

export const UploadArea: React.FC<UploadAreaProps> = ({ onUpload, disabled = false, compact = false, disabledHint, targetLabel }) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleUploadFiles = async (files: File[]) => {
    if (files.length === 0) return false;
    return onUpload(files[0], files);
  };

  const validateFile = (file: File) => {
    const isImage = file.type.startsWith('image/');
    const isLt10M = file.size / 1024 / 1024 < 10;
    if (!isImage) {
      message.error('You can only upload image files!');
      return false;
    }
    if (!isLt10M) {
      message.error('Image must be smaller than 10MB!');
      return false;
    }
    return true;
  };

  const readDirectoryEntries = (directoryEntry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => {
      const reader = directoryEntry.createReader();
      const entries: FileSystemEntry[] = [];
      const readBatch = () => {
        reader.readEntries(
          (batch) => {
            if (batch.length === 0) {
              resolve(entries);
              return;
            }
            entries.push(...batch);
            readBatch();
          },
          (err) => reject(err),
        );
      };
      readBatch();
    });

  const getFilesFromEntry = async (entry: FileSystemEntry): Promise<File[]> => {
    if (entry.isFile) {
      return new Promise((resolve) => {
        (entry as FileSystemFileEntry).file((file) => resolve([file]), () => resolve([]));
      });
    }
    if (entry.isDirectory) {
      const directoryEntries = await readDirectoryEntries(entry as FileSystemDirectoryEntry);
      const nestedFiles = await Promise.all(directoryEntries.map(getFilesFromEntry));
      return nestedFiles.flat();
    }
    return [];
  };

  const getFilesFromDataTransferItems = async (items: DataTransferItemList): Promise<File[]> => {
    const itemList = Array.from(items);
    const files = await Promise.all(
      itemList.map(async (item) => {
        const entry = (item as unknown as { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.();
        if (entry) return getFilesFromEntry(entry);
        const file = item.getAsFile?.();
        return file ? [file] : [];
      }),
    );
    return files.flat();
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    setIsDragging(false);
    if (disabled) return;
    event.preventDefault();

    const { items } = event.dataTransfer;
    if (!items || items.length === 0) return;

    const files = await getFilesFromDataTransferItems(items);
    const validFiles = files.filter(validateFile);
    if (validFiles.length === 0) {
      message.error('No valid images found in the dropped folder.');
      return;
    }
    await handleUploadFiles(validFiles);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    const validFiles = files.filter(validateFile);
    if (validFiles.length > 0) handleUploadFiles(validFiles);
    if (e.target) e.target.value = '';
  };

  const hiddenInputs = (
    <>
      <input ref={fileInputRef} type="file" multiple accept="image/*" className="hidden" onChange={handleInputChange} />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error — chromium-only `webkitdirectory` attribute
        webkitdirectory=""
        directory=""
        accept="image/*"
        className="hidden"
        onChange={handleInputChange}
      />
    </>
  );

  if (compact) {
    return (
      <div
        onDragEnter={() => !disabled && setIsDragging(true)}
        onDragOver={(e) => {
          e.preventDefault();
          !disabled && setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'flex min-h-[340px] flex-col items-center justify-center gap-3 rounded-2xl border-[1.5px] border-dashed px-6 py-10 text-center transition-colors',
          disabled
            ? 'cursor-not-allowed border-slate-300 bg-slate-50'
            : isDragging
            ? 'border-slate-800 bg-slate-100'
            : 'border-slate-400 bg-white',
        )}
      >
        <span
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-2xl',
            disabled ? 'bg-slate-100 text-slate-400' : 'bg-slate-100 text-slate-800',
          )}
        >
          <UploadIcon className="h-6 w-6" />
        </span>
        <b className={cn('text-lg', disabled ? 'text-slate-500' : 'text-slate-900')}>
          {disabled ? disabledHint || 'Upload disabled' : 'Drop garment photos or folders here'}
        </b>
        <span className="text-[13px] text-slate-600">JPG, PNG or WEBP · up to 10 MB each · single or bulk</span>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <Button
            disabled={disabled}
            className="h-11 bg-slate-800 px-5 text-white hover:bg-slate-900"
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadIcon />
            Browse files
          </Button>
          <Button
            variant="outline"
            disabled={disabled}
            className="h-11 border-slate-300 px-5 text-slate-800 hover:border-slate-800 hover:bg-slate-50"
            onClick={() => folderInputRef.current?.click()}
          >
            <FolderOpen />
            Select folder
          </Button>
        </div>
        {targetLabel && !disabled && (
          <span className="mt-1 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
            Uploading to <b className="text-slate-900">{targetLabel}</b>
          </span>
        )}
        {hiddenInputs}
      </div>
    );
  }

  return (
    <Card className="upload-area overflow-hidden rounded-2xl">
      <CardContent className="p-10 text-center">
        {/* Header */}
        <div className="mb-8">
          <ImageIcon
            className="mx-auto mb-4 h-16 w-16"
            style={{ color: disabled ? '#d9d9d9' : '#FF6F61' }}
          />
          <h3
            className="m-0 text-2xl font-semibold"
            style={{ color: disabled ? '#d9d9d9' : '#FF6F61' }}
          >
            {disabled ? 'AI Processing Images...' : 'Upload Fashion Images'}
          </h3>
          <p className="mt-2 text-base text-muted-foreground">
            {disabled
              ? 'Please wait while AI extracts attributes from your images'
              : 'AI will analyze each image and extract fashion attributes'}
          </p>
        </div>

        {/* Drag-and-drop zone */}
        <div
          onDragEnter={() => !disabled && setIsDragging(true)}
          onDragOver={(e) => {
            e.preventDefault();
            !disabled && setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => !disabled && fileInputRef.current?.click()}
          className={cn(
            'cursor-pointer rounded-xl border-2 border-dashed px-5 py-10 transition-all',
            disabled
              ? 'cursor-not-allowed border-border bg-muted/50'
              : isDragging
              ? 'border-primary bg-primary/5'
              : 'border-primary bg-primary/[0.02] hover:bg-primary/[0.05]',
          )}
        >
          <Inbox
            className="mx-auto mb-4 h-12 w-12"
            style={{ color: disabled ? '#d9d9d9' : '#FF6F61' }}
          />
          <div className="mb-2 text-lg font-medium">
            {disabled ? 'Upload disabled during processing' : 'Click or drag files to this area to upload'}
          </div>
          <div className="text-sm text-muted-foreground">
            Support for single or bulk upload. Only image files (JPG, PNG, WEBP) under 10MB.
          </div>
        </div>

        {/* Alt buttons */}
        <div className="mt-6">
          <Button
            size="lg"
            disabled={disabled}
            className="min-w-[200px]"
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadIcon />
            {disabled ? 'Processing...' : 'Select Files'}
          </Button>
          <Button
            size="lg"
            variant="outline"
            disabled={disabled}
            className="ml-3 min-w-[200px]"
            onClick={() => folderInputRef.current?.click()}
          >
            <FolderOpen />
            {disabled ? 'Processing...' : 'Select Folder'}
          </Button>

          {hiddenInputs}

          <div className="mt-2 text-xs text-muted-foreground">or drag and drop images/folders above</div>
        </div>

        {/* Features */}
        <div className="mt-8 rounded-xl bg-muted/40 p-6 text-left">
          <strong className="text-sm text-primary">AI-Powered Features:</strong>
          <ul className="mt-2 list-disc pl-5 text-[13px] text-muted-foreground">
            <li>Automatic attribute extraction using GPT-4 Vision</li>
            <li>Confidence scoring for each detected attribute</li>
            <li>Discovery mode to find attributes beyond your schema</li>
            <li>Batch processing with real-time progress tracking</li>
            <li>Export results to Excel or CSV format</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};

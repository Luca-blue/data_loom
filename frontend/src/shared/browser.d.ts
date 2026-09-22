interface FileSystemSyncAccessHandle {
  read(buffer: ArrayBufferView, options?: { at?: number }): number;
  write(buffer: ArrayBufferView, options?: { at?: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
  getSize(): number;
}
interface FileSystemFileHandle {
  createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
  queryPermission(options?: { mode: string }): Promise<PermissionState>;
  requestPermission(options?: { mode: string }): Promise<PermissionState>;
}
interface Window {
  showOpenFilePicker(options?: any): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(options?: any): Promise<FileSystemFileHandle>;
  showDirectoryPicker(options?: any): Promise<FileSystemDirectoryHandle>;
}

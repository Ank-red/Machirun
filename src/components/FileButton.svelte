<script lang="ts">
  // --- Props ---

  let {
    label,
    icon = "upload_file",
    accept = "*/*",
    multiple = false,
    disabled = false,
    variant = "border",
    onselect,
  }: {
    label: string;
    icon?: string;
    accept?: string;
    multiple?: boolean;
    disabled?: boolean;
    variant?: string;
    onselect: (files: FileList) => void;
  } = $props();

  // --- State ---

  /** 非表示のファイル入力要素参照 */
  let fileInput: HTMLInputElement;

  // --- Handlers & Methods ---

  /**
   * 隠しファイル入力要素のクリックイベントを発火させる
   */
  function triggerSelect(): void {
    fileInput?.click();
  }

  /**
   * ファイル選択時に親コンポーネントへFileListを渡し、入力値をリセットする
   * @param event ファイル入力のchangeイベント
   */
  function handleChange(event: Event): void {
    const target = event.currentTarget as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      onselect(target.files);
      target.value = "";
    }
  }
</script>

<!-- ファイル選択トリガーボタン -->
<button type="button" class={variant} {disabled} onclick={triggerSelect}>
  <i>{icon}</i>
  <span>{label}</span>
</button>
<input
  bind:this={fileInput}
  type="file"
  {accept}
  {multiple}
  hidden
  onchange={handleChange}
/>

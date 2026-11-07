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
   */
  function handleChange(e: Event): void {
    const target = e.currentTarget as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      onselect(target.files);
      target.value = ""; // 同じファイルを再度選択できるようにリセット
    }
  }
</script>

<!-- ファイル選択トリガーボタン -->
<button class={variant} {disabled} onclick={triggerSelect}>
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

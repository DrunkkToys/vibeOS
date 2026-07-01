// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>

import { createSignal, onMount } from "solid-js"

export default function CreateForm(props: {
  placeholder: string
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [v, setV] = createSignal("")
  let inputRef: HTMLInputElement | undefined
  onMount(() => inputRef?.focus())

  return (
    <div class="create-form">
      <input
        ref={inputRef}
        class="create-input"
        placeholder={props.placeholder}
        value={v()}
        onInput={(e) => setV(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && v().trim()) props.onSubmit(v().trim())
          if (e.key === "Escape") props.onCancel()
        }}
      />
      <button class="create-ok" disabled={!v().trim()} onClick={() => { if (v().trim()) props.onSubmit(v().trim()) }}>ok</button>
      <button class="create-cancel" onClick={props.onCancel}>x</button>
    </div>
  )
}

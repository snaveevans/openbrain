export function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Expected #${id} to exist.`);
  }

  return element as T;
}

export function setNotice(element: HTMLElement, message: string, tone: "default" | "error" | "success" = "default"): void {
  element.textContent = message;
  element.hidden = false;
  if (tone === "default") {
    element.removeAttribute("data-tone");
    return;
  }

  element.dataset.tone = tone;
}

export function clearNotice(element: HTMLElement): void {
  element.hidden = true;
  element.textContent = "";
  element.removeAttribute("data-tone");
}

export function setBusy(button: HTMLButtonElement, busy: boolean, idleLabel: string, busyLabel: string): void {
  button.disabled = busy;
  button.textContent = busy ? busyLabel : idleLabel;
}

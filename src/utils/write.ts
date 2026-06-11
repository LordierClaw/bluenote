export function write(stream: NodeJS.WritableStream | undefined, text: string): void {
  if (stream && typeof stream.write === "function") {
    stream.write(text)
  }
}

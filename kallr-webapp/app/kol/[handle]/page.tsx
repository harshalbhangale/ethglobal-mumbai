import { redirect } from "next/navigation";

/** A caller opens inside the one screen, with their record on top of their posts. */
export default async function CallerPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  redirect(/^[A-Za-z0-9_]{1,15}$/.test(handle) ? `/app?caller=${handle.toLowerCase()}` : "/app");
}

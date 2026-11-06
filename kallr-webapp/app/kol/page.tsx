import { redirect } from "next/navigation";

/** Callers live in the one screen now: Explore in the feed. */
export default function CallersPage() {
  redirect("/app#feed");
}

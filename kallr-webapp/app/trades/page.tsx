import { redirect } from "next/navigation";

/** Orders and trade history (with Arkiv proofs) live in the one screen now. */
export default function TradesPage() {
  redirect("/app#orders");
}

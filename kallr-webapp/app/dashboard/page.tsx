import { redirect } from "next/navigation";

/** One dashboard: the desk at /app (Following, Trade, Orders, Wallet). Old links land there. */
export default function DashboardPage() {
  redirect("/app");
}

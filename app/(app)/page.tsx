import { redirect } from "next/navigation";

// The dashboard arrives in M6; until then the rules editor is the landing page.
export default function Home() {
  redirect("/rules");
}

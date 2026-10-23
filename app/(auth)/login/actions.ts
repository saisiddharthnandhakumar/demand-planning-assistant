"use server";

import { redirect } from "next/navigation";
import { passwordMatches, safeNextPath } from "@/lib/auth";
import { endSession, startSession } from "@/lib/session";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? ""));
  if (!(await passwordMatches(process.env.APP_PASSWORD ?? "", password))) {
    return { error: "Incorrect password." };
  }
  await startSession();
  redirect(next);
}

export async function logout() {
  await endSession();
  redirect("/login");
}

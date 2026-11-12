import { redirect } from "next/navigation";

/** Account linking removed — sessions are password-gated. */
export default function SignInPage() {
  redirect("/");
}

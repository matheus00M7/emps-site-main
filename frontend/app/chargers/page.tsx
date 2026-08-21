import { redirect } from "next/navigation";

// Aba dedicada de carregadores pausada por enquanto.
// O painel principal agora concentra a visualizacao de infraestrutura.
export default function Page() {
  redirect("/dashboard");
}

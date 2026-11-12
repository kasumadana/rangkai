import { useEffect } from "react";
import { useSearchParams } from "react-router";
export function PublicAssistantPage() {
 const [params] = useSearchParams();
 useEffect(() => { window.dispatchEvent(new CustomEvent("rangkai:assistant-open", { detail: params.get("event") ?? "" })); }, [params]);
 return <main className="teduh-page-shell"><p>Asisten terbuka. Gunakan tombol Asisten untuk membukanya kembali.</p></main>;
}

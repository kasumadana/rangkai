import { useEffect, useRef } from "react";
import { useBlocker, useNavigate } from "react-router";
import { useAuthSession } from "./auth";

/** Block in-app and history navigation while a form has unsaved changes. */
export function useUnsavedChanges(dirty: boolean, onLeave?: () => void) {
 const sessionEnded = useRef(false);
 const previousUser = useRef<string | null>(null);
 const navigate = useNavigate();
 const { data: session } = useAuthSession();
 useEffect(() => {
  const id = session?.user.id ?? null;
  if (previousUser.current && session !== undefined && id !== previousUser.current) {
   sessionEnded.current = true;
   sessionStorage.removeItem("rangkai:event-wizard-draft-v1");
   sessionStorage.removeItem("rangkai:event-wizard-id");
   sessionStorage.removeItem("rangkai:event-wizard-mode");
   navigate("/", { replace: true });
  }
  if (id) previousUser.current = id;
 }, [session, navigate]);
 const blocker = useBlocker(() => {
  if (!dirty || sessionEnded.current) { onLeave?.(); return false; }
  return true;
 });
 useEffect(() => {
  const ended = () => {
   sessionEnded.current = true;
   sessionStorage.removeItem("rangkai:event-wizard-draft-v1");
   sessionStorage.removeItem("rangkai:event-wizard-id");
   sessionStorage.removeItem("rangkai:event-wizard-mode");
  };
  window.addEventListener("rangkai:session-changed", ended);
  return () => window.removeEventListener("rangkai:session-changed", ended);
 }, []);
 useEffect(() => {
  if (blocker.state !== "blocked") return;
  if (window.confirm("Perubahan belum disimpan. Tinggalkan halaman ini?")) { onLeave?.(); blocker.proceed(); }
  else blocker.reset();
 }, [blocker, onLeave]);
 useEffect(() => {
  if (!dirty) return;
  const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
  window.addEventListener("beforeunload", unload);
  return () => window.removeEventListener("beforeunload", unload);
 }, [dirty]);
}

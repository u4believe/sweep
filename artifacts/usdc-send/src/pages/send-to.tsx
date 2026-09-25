import { useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { stashPayTo } from "@/lib/pay-qr";

// Target of a user's payment QR code (/send/<payment ID>): opens Send with that
// recipient filled in, going through log in first if needed.
export default function SendTo() {
  const { paymentId = "" } = useParams<{ paymentId: string }>();
  const [, setLocation] = useLocation();

  useEffect(() => {
    const id = decodeURIComponent(paymentId).trim().toLowerCase();
    if (id) stashPayTo(id);
    const loggedIn = !!localStorage.getItem("token");
    setLocation(loggedIn ? "/" : `/login?next=${encodeURIComponent(`/send/${paymentId}`)}`, { replace: true });
  }, [paymentId]);

  return null;
}

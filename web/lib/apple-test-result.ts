export function appleTestDeliveryMessage(delivery: string | null | undefined, environment: "sandbox" | "production"):
  { tone: "accent" | "danger" | "neutral"; text: string } {
  if (delivery === "SUCCESS") return { tone: "accent", text: `Apple delivered the ${environment} test notification. Salebell records it even if you haven't chosen any alerts.` };
  if (!delivery) return { tone: "neutral", text: "Apple accepted the test request. Delivery is still pending; the connection status updates when it arrives. You don't need to choose an alert destination." };
  const reason = delivery === "UNSUCCESSFUL_HTTP_RESPONSE_CODE"
    ? "The notification URL returned an unsuccessful HTTP response."
    : delivery === "TLS_ISSUE" ? "Apple couldn't establish a secure connection to the notification URL."
    : delivery === "TIMED_OUT" || delivery === "NO_RESPONSE" ? "The notification URL didn't respond in time."
    : "Apple couldn't complete delivery to the notification URL.";
  return { tone: "danger", text: `${reason} Check the ${environment} URL in App Store Connect and try again.${environment === "sandbox" ? " Recently saved sandbox URLs can take up to an hour to apply." : ""}` };
}

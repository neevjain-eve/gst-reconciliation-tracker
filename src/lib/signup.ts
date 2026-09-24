/**
 * Who may create an organisation?
 *  • Always. Signup is permanently open (multi-organisation, self-serve) — each organisation
 *    created via /register is its own isolated tenant, with no visibility into any other
 *    organisation's clients, invoices or reconciliation data.
 *  • Set ALLOW_SIGNUP="false" to go back to "closed once the firm's own account is set up"
 *    (colleagues are then added from Settings by an existing admin instead of registering).
 */
export async function signupOpen(): Promise<boolean> {
  return process.env.ALLOW_SIGNUP !== "false";
}

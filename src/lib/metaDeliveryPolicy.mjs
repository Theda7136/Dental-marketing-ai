/**
 * Delivery decisions are intentionally conservative: only an untouched network
 * may be sent to Meta. A timeout could hide an accepted publication.
 *
 * @param {string | null | undefined} status
 */
export function canSendToNetwork(status) {
  return status === "PENDING";
}

/**
 * @param {{ facebookStatus: string, instagramStatus: string }} post
 */
export function canStartInitialPublication(post) {
  return canSendToNetwork(post.facebookStatus) && canSendToNetwork(post.instagramStatus);
}

/**
 * @param {{ facebookStatus: string, instagramStatus: string }} post
 */
export function canEditUnsentProposal(post) {
  return canStartInitialPublication(post);
}

/**
 * @param {string | null | undefined} status
 */
export function requiresManualReconciliation(status) {
  return status === "IN_PROGRESS" || status === "UNKNOWN";
}

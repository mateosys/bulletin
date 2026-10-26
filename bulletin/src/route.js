// "/u/dummyjones" -> "dummyjones"; anything else -> null
const match = window.location.pathname.match(/^\/u\/([a-z0-9_]{3,20})\/?$/i);

export const profileUsername = match ? match[1].toLowerCase() : null;
export function sessionSecret(): string {
 const secret=process.env.JWT_SECRET;
 if(!secret || secret.length<32) throw new Error('JWT_SECRET debe contener al menos 32 caracteres');
 return secret;
}

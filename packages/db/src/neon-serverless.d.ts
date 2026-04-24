declare module "@neondatabase/serverless" {
  export function neon(connectionString: string): (...args: any[]) => Promise<any>;
}

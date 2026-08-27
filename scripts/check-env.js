const requiredEnvVars = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'GOREKK_API_KEY',
  'GOREKK_STATIC_QR',
]

const missingEnvVars = requiredEnvVars.filter(
  (envVar) => !process.env[envVar]
)

if (missingEnvVars.length > 0) {
  console.warn(
    `\n⚠️  Missing required environment variables:\n${missingEnvVars
      .map((env) => `  - ${env}`)
      .join('\n')}\n\nPlease add them to your .env.local file.\n`
  )
}

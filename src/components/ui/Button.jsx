import { motion } from 'framer-motion'

export function Button({ children, variant = 'primary', className = '', icon: Icon, ...props }) {
  const variants = {
    primary: 'bg-blue-500 text-white shadow-lg shadow-blue-500/20 hover:bg-blue-400',
    success: 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-400',
    ghost: 'border border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]',
    danger: 'border border-red-400/30 bg-red-500/10 text-red-200 hover:bg-red-500/20',
    dark: 'border border-white/10 bg-[#0d0e14] text-white hover:bg-[#171822]',
  }
  return (
    <motion.button type="button"
      whileTap={{ scale: 0.98 }}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition ${variants[variant]} ${className}`}
      {...props}
    >
      {Icon ? <Icon size={17} /> : null}
      {children}
    </motion.button>
  )
}

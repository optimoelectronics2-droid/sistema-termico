import { useState } from 'react'
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, updateProfile } from 'firebase/auth'
import { auth } from '../../lib/firebase'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../hooks/useToast'

export function AuthPage() {
  const toast = useToast()
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setLoading(true)
    try {
      if (!form.email || !form.password) throw new Error('Email y contraseña son obligatorios.')
      if (mode === 'register') {
        const credential = await createUserWithEmailAndPassword(auth, form.email, form.password)
        if (form.name) await updateProfile(credential.user, { displayName: form.name })
        toast.success('Usuario registrado correctamente.')
      } else {
        await signInWithEmailAndPassword(auth, form.email, form.password)
        toast.success('Sesion iniciada correctamente.')
      }
    } catch (error) {
      toast.error(firebaseMessage(error))
    } finally {
      setLoading(false)
    }
  }

  async function resetPassword() {
    try {
      if (!form.email) throw new Error('Escriba su email para recuperar contraseña.')
      await sendPasswordResetEmail(auth, form.email)
      toast.success('Correo de recuperacion enviado.')
    } catch (error) {
      toast.error(firebaseMessage(error))
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#0A0A0F] p-4 text-white">
      <form onSubmit={submit} className="panel w-full max-w-md rounded-lg p-6">
        <div className="mb-6">
          <div className="mb-4 grid h-12 w-12 place-items-center rounded-lg bg-blue-500 font-display text-2xl font-bold">T</div>
          <h1 className="font-display text-3xl font-bold">Trifusion ERP Fiscal</h1>
          <p className="mt-2 text-sm text-white/45">{mode === 'login' ? 'Inicia sesion con Firebase Authentication.' : 'Registra el primer usuario del sistema.'}</p>
        </div>
        <div className="space-y-3">
          {mode === 'register' ? <Input id="auth-name" name="name" label="Nombre" value={form.name} onChange={(value) => setForm((state) => ({ ...state, name: value }))} /> : null}
          <Input id="auth-email" name="email" label="Email" value={form.email} onChange={(value) => setForm((state) => ({ ...state, email: value }))} />
          <Input id="auth-password" name="password" label="Contraseña" type="password" value={form.password} onChange={(value) => setForm((state) => ({ ...state, password: value }))} />
        </div>
        <Button disabled={loading} className="mt-5 w-full" type="submit">{loading ? 'Procesando...' : mode === 'login' ? 'Iniciar sesion' : 'Registrarse'}</Button>
        <div className="mt-4 flex justify-between text-sm">
          <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')} className="text-blue-300">{mode === 'login' ? 'Crear cuenta' : 'Ya tengo cuenta'}</button>
          <button type="button" onClick={resetPassword} className="text-white/50">Recuperar contraseña</button>
        </div>
      </form>
    </main>
  )
}

function Input({ id, name, label, value, onChange, type = 'text' }) {
  return <label htmlFor={id}><span className="label-dark">{label}</span><input id={id} name={name || id} type={type} value={value} onChange={(event) => onChange(event.target.value)} className="input-dark" /></label>
}

function firebaseMessage(error) {
  const code = error?.code || ''
  if (code.includes('email-already-in-use')) return 'Ese email ya esta registrado.'
  if (code.includes('invalid-credential')) return 'Credenciales invalidas. Verifique email y contraseña.'
  if (code.includes('user-not-found')) return 'No existe una cuenta con ese email.'
  if (code.includes('wrong-password')) return 'Contraseña incorrecta.'
  if (code.includes('invalid-email')) return 'El email no tiene un formato valido.'
  if (code.includes('too-many-requests')) return 'Demasiados intentos. Espere un momento e intente otra vez.'
  if (code.includes('weak-password')) return 'La contraseña debe tener al menos 6 caracteres.'
  return error.message || 'No se pudo completar la autenticacion.'
}

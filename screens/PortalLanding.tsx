
import React, { useState } from 'react';
import { GameLogo } from '../components/GameLogo';
import { loginWithEmail, registerWithEmail, loginWithGoogle } from '../services/authService';

interface PortalLandingProps {
    onLoginSuccess: () => void;
    user: any;
}

export const PortalLanding: React.FC<PortalLandingProps> = ({ onLoginSuccess, user }) => {
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [authEmail, setAuthEmail] = useState("");
    const [authPassword, setAuthPassword] = useState("");
    const [isRegistering, setIsRegistering] = useState(false);

    const handleGoogleLogin = async () => {
        try {
            await loginWithGoogle();
            // Auth listener will handle the redirect
        } catch (e) {
            console.error("Google Login Error", e);
        }
    };

    return (
        <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-12 p-6 overflow-hidden relative font-sans text-slate-800">
            {/* Background Light Theme */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-50 via-white to-slate-100"></div>
            
            {/* Décoration subtile */}
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-emerald-400 to-blue-500"></div>

            <div className="relative z-10 scale-125 md:scale-150 mb-12">
                <GameLogo theme="light" />
            </div>

            <div className="relative z-10 flex flex-col items-center gap-4 w-full max-w-xs">
              <button 
                  onClick={() => user ? onLoginSuccess() : setShowLoginModal(true)} 
                  className="group relative w-full overflow-hidden px-8 py-4 bg-slate-900 text-white font-black rounded-2xl text-xl transition-all hover:scale-105 active:scale-95 shadow-xl shadow-slate-200"
              >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                      DÉMARRER <span className="text-emerald-400">➔</span>
                  </span>
                  <div className="absolute inset-0 bg-slate-800 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
              </button>
              <p className="text-slate-400 text-[10px] uppercase font-bold tracking-[0.3em] animate-pulse">
                  System Ready • V 1.0.4
              </p>
            </div>

            {showLoginModal && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white p-8 rounded-3xl w-full max-w-sm border border-slate-100 shadow-2xl animate-scale-in">
                        <h2 className="text-2xl font-black text-slate-900 mb-6 uppercase tracking-tighter text-center">
                            {isRegistering ? "Créer un profil" : "Identification"}
                        </h2>
                        
                        {/* Google Button */}
                        <button 
                            onClick={handleGoogleLogin}
                            className="w-full py-3 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-50 transition-all flex items-center justify-center gap-3 mb-6 shadow-sm"
                        >
                            <svg className="w-5 h-5" viewBox="0 0 24 24">
                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                            </svg>
                            Continuer avec Google
                        </button>

                        <div className="relative mb-6">
                            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
                            <div className="relative flex justify-center text-xs"><span className="px-2 bg-white text-slate-400 font-bold uppercase">Ou par email</span></div>
                        </div>

                        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); isRegistering ? registerWithEmail(authEmail, authPassword) : loginWithEmail(authEmail, authPassword); }}>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Email</label>
                              <input type="email" placeholder="nom@exemple.com" className="w-full p-4 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium" value={authEmail} onChange={e => setAuthEmail(e.target.value)} />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Mot de Passe</label>
                              <input type="password" placeholder="••••••••" className="w-full p-4 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium" value={authPassword} onChange={e => setAuthPassword(e.target.value)} />
                            </div>
                            <button className="w-full py-4 bg-slate-900 text-white font-black rounded-xl hover:bg-slate-800 shadow-lg shadow-slate-200 transition-all mt-2">
                                {isRegistering ? "CRÉER LE COMPTE" : "CONNEXION"}
                            </button>
                        </form>
                        <div className="mt-6 flex flex-col gap-3 text-center">
                          <button onClick={() => setIsRegistering(!isRegistering)} className="text-blue-600 text-xs font-bold hover:underline">
                              {isRegistering ? "J'ai déjà un compte" : "Je n'ai pas de compte"}
                          </button>
                          <button onClick={() => setShowLoginModal(false)} className="text-slate-400 text-xs font-bold hover:text-slate-600 uppercase tracking-widest mt-2">
                              Annuler
                          </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

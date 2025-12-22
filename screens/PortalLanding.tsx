
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
        } catch (e) {
            console.error("Google Login Error", e);
        }
    };

    return (
        <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-12 p-6 font-sans text-stone-900">
            
            {/* Design Épuré (Pas de blobs de couleur) */}
            <div className="absolute top-0 w-full h-1 bg-stone-100"></div>

            <div className="relative z-10 scale-125 md:scale-150 mb-8">
                <GameLogo theme="light" />
            </div>

            <div className="relative z-10 flex flex-col items-center gap-6 w-full max-w-xs animate-fade-in-up">
              <button 
                  onClick={() => user ? onLoginSuccess() : setShowLoginModal(true)} 
                  className="group relative w-full overflow-hidden px-8 py-4 bg-stone-900 text-white font-black rounded-xl text-lg transition-all hover:scale-105 active:scale-95 shadow-xl shadow-stone-200"
              >
                  <span className="relative z-10 flex items-center justify-center gap-3 tracking-wide">
                      COMMENCER <span className="text-emerald-400">➔</span>
                  </span>
              </button>
              <p className="text-stone-300 text-[10px] uppercase font-bold tracking-[0.3em]">
                  GeoSim Engine v1.0.4
              </p>
            </div>

            {showLoginModal && (
                <div className="fixed inset-0 bg-stone-100/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white p-8 rounded-2xl w-full max-w-sm border border-stone-200 shadow-2xl animate-scale-in">
                        <h2 className="text-2xl font-black text-stone-900 mb-8 uppercase tracking-tight text-center">
                            {isRegistering ? "Nouveau Profil" : "Connexion"}
                        </h2>
                        
                        {/* Bouton Google Prominent */}
                        <button 
                            onClick={handleGoogleLogin}
                            className="w-full py-3.5 bg-white border border-stone-300 hover:bg-stone-50 text-stone-700 font-bold rounded-lg transition-all flex items-center justify-center gap-3 mb-8 shadow-sm group"
                        >
                            <svg className="w-5 h-5 group-hover:scale-110 transition-transform" viewBox="0 0 24 24">
                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                            </svg>
                            Continuer avec Google
                        </button>

                        <div className="relative mb-8">
                            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-stone-200"></div></div>
                            <div className="relative flex justify-center text-xs"><span className="px-3 bg-white text-stone-400 font-bold uppercase tracking-wide">Ou via email</span></div>
                        </div>

                        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); isRegistering ? registerWithEmail(authEmail, authPassword) : loginWithEmail(authEmail, authPassword); }}>
                            <div className="space-y-1">
                              <input type="email" placeholder="Email" className="w-full p-3.5 bg-stone-50 border border-stone-200 text-stone-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-400 transition-all font-medium placeholder-stone-400" value={authEmail} onChange={e => setAuthEmail(e.target.value)} />
                            </div>
                            <div className="space-y-1">
                              <input type="password" placeholder="Mot de passe" className="w-full p-3.5 bg-stone-50 border border-stone-200 text-stone-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-400 transition-all font-medium placeholder-stone-400" value={authPassword} onChange={e => setAuthPassword(e.target.value)} />
                            </div>
                            <button className="w-full py-3.5 bg-stone-900 text-white font-bold rounded-lg hover:bg-black shadow-lg shadow-stone-200 transition-all mt-4 tracking-wide">
                                {isRegistering ? "CRÉER UN COMPTE" : "SE CONNECTER"}
                            </button>
                        </form>
                        <div className="mt-6 flex flex-col gap-4 text-center">
                          <button onClick={() => setIsRegistering(!isRegistering)} className="text-stone-500 text-xs font-bold hover:text-stone-800 underline underline-offset-4">
                              {isRegistering ? "J'ai déjà un compte" : "Créer un compte avec une adresse email"}
                          </button>
                          <button onClick={() => setShowLoginModal(false)} className="text-stone-300 text-[10px] font-bold hover:text-red-400 uppercase tracking-widest">
                              Annuler
                          </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

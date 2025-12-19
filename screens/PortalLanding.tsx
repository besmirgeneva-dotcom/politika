
import React, { useState } from 'react';
import { GameLogo } from '../components/GameLogo';
import { loginWithEmail, registerWithEmail } from '../services/authService';

interface PortalLandingProps {
    onLoginSuccess: () => void;
    user: any;
}

export const PortalLanding: React.FC<PortalLandingProps> = ({ onLoginSuccess, user }) => {
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [authEmail, setAuthEmail] = useState("");
    const [authPassword, setAuthPassword] = useState("");
    const [isRegistering, setIsRegistering] = useState(false);

    return (
        <div className="min-h-screen bg-stone-900 flex flex-col items-center justify-center gap-12 p-6 overflow-hidden relative">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-stone-900 to-stone-950"></div>
            <div className="relative z-10 scale-125 md:scale-150 mb-12">
                <GameLogo />
            </div>
            <div className="relative z-10 flex flex-col items-center gap-4 w-full max-w-xs">
              <button 
                  onClick={() => user ? onLoginSuccess() : setShowLoginModal(true)} 
                  className="group relative w-full overflow-hidden px-8 py-4 bg-white text-stone-950 font-black rounded-2xl text-xl transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.3)]"
              >
                  <span className="relative z-10">DÉMARRER LE PROTOCOLE ➔</span>
                  <div className="absolute inset-0 bg-emerald-400 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
              </button>
              <p className="text-stone-500 text-[10px] uppercase font-bold tracking-[0.3em] animate-pulse">Waiting for authorization...</p>
            </div>

            {showLoginModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
                    <div className="bg-stone-900 p-8 rounded-3xl w-full max-w-sm border border-stone-800 shadow-2xl animate-scale-in">
                        <h2 className="text-2xl font-black text-white mb-6 uppercase tracking-tighter">{isRegistering ? "NOUVEAU COMPTE" : "ACCÈS SÉCURISÉ"}</h2>
                        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); isRegistering ? registerWithEmail(authEmail, authPassword) : loginWithEmail(authEmail, authPassword); }}>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-stone-500 uppercase ml-1">Identifiant Email</label>
                              <input type="email" placeholder="agent@geosim.net" className="w-full p-4 bg-stone-800 border border-stone-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 transition-all" value={authEmail} onChange={e => setAuthEmail(e.target.value)} />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-stone-500 uppercase ml-1">Mot de Passe</label>
                              <input type="password" placeholder="••••••••" className="w-full p-4 bg-stone-800 border border-stone-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 transition-all" value={authPassword} onChange={e => setAuthPassword(e.target.value)} />
                            </div>
                            <button className="w-full py-4 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-500 shadow-lg shadow-blue-900/20 transition-all">{isRegistering ? "S'ENREGISTRER" : "SE CONNECTER"}</button>
                        </form>
                        <div className="mt-6 flex flex-col gap-3">
                          <button onClick={() => setIsRegistering(!isRegistering)} className="text-blue-400 text-xs font-bold hover:underline">{isRegistering ? "Déjà un profil ? Connexion" : "Créer un nouveau profil agent"}</button>
                          <button onClick={() => setShowLoginModal(false)} className="text-stone-500 text-xs font-bold hover:text-white uppercase tracking-widest">Abandonner</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

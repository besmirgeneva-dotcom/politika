
import React from 'react';
import { getFlagUrl } from '../constants';
import { SaveMetadata } from '../hooks/useGamePersistence';

interface PortalDashboardProps {
    user: any;
    logout: () => void;
    launchGeoSim: () => void;
    availableSaves: SaveMetadata[];
    loadGameById: (id: string) => void;
    deleteGame: (id: string) => void;
}

export const PortalDashboard: React.FC<PortalDashboardProps> = ({ 
    user, logout, launchGeoSim, availableSaves, loadGameById, deleteGame 
}) => {
    return (
        <div className="min-h-screen bg-white p-6 md:p-12 relative overflow-hidden font-sans text-slate-900">
            {/* Décoration Light */}
            <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-blue-50 rounded-full blur-[100px] -z-10 opacity-60"></div>
            <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-emerald-50 rounded-full blur-[100px] -z-10 opacity-60"></div>
            
            <div className="max-w-5xl mx-auto relative z-10">
                {/* Header */}
                <div className="flex justify-between items-end mb-12 border-b border-slate-100 pb-8">
                  <div>
                      <h1 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tighter uppercase mb-2">
                          POLITIKA<span className="text-emerald-500">_HUB</span>
                      </h1>
                      <p className="text-slate-400 font-mono text-xs uppercase tracking-[0.2em] font-bold">
                          Terminal d'administration v1.0.4
                      </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                      <div className="flex items-center gap-3 bg-white p-2 pl-3 rounded-full border border-slate-200 shadow-sm">
                          <div className="hidden md:block text-right">
                              <div className="text-[10px] text-slate-400 font-bold leading-none uppercase">Agent</div>
                              <div className="text-xs text-slate-900 font-bold truncate max-w-[150px]">{user?.email}</div>
                          </div>
                          <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white font-bold text-xs shadow-md">
                              {user?.email?.[0].toUpperCase() || 'A'}
                          </div>
                          <button onClick={logout} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-red-500 transition-colors" title="Déconnexion">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                          </button>
                      </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Nouvelle Partie Card */}
                    <div className="lg:col-span-1 flex flex-col">
                      <div 
                          onClick={launchGeoSim}
                          className="group relative flex-1 bg-slate-900 text-white rounded-[2rem] p-8 cursor-pointer overflow-hidden transition-all hover:scale-[1.02] shadow-2xl shadow-slate-200"
                      >
                          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                              <span className="text-9xl group-hover:rotate-12 transition-transform block">🌍</span>
                          </div>
                          <div className="relative z-10 h-full flex flex-col">
                              <div className="mb-auto">
                                  <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center mb-6 backdrop-blur-sm border border-white/10">
                                      <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                  </div>
                                  <h2 className="text-3xl font-black leading-tight uppercase mb-4 tracking-tight">Nouvelle<br/>Simulation</h2>
                                  <p className="text-slate-400 text-sm leading-relaxed font-medium">Initiez un nouveau scénario. Prenez les commandes d'une nation et réécrivez l'histoire.</p>
                              </div>
                              <div className="mt-8">
                                  <div className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-500 group-hover:bg-emerald-400 text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-900/20">
                                      LANCER
                                      <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                                  </div>
                              </div>
                          </div>
                      </div>
                    </div>

                    {/* Sauvegardes List */}
                    <div className="lg:col-span-2 bg-slate-50 rounded-[2.5rem] border border-slate-200 p-8 flex flex-col">
                        <div className="flex items-center justify-between mb-8">
                          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-3">
                              <span className="w-8 h-8 bg-white rounded-lg text-slate-500 flex items-center justify-center shadow-sm border border-slate-200">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
                              </span>
                              ARCHIVES
                          </h2>
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-white px-3 py-1 rounded-full border border-slate-200 shadow-sm">
                              {availableSaves.length} slots
                          </span>
                        </div>

                        <div className="flex-1 space-y-3 overflow-y-auto max-h-[400px] pr-2 scrollbar-hide">
                            {availableSaves.length === 0 ? (
                              <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-3xl p-12 text-center opacity-60">
                                  <div className="text-4xl mb-4 grayscale opacity-30">💾</div>
                                  <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">Aucune sauvegarde</p>
                              </div>
                            ) : availableSaves.map(s => (
                                <div 
                                  key={s.id} 
                                  className="group flex flex-col md:flex-row md:items-center justify-between p-4 bg-white border border-slate-200 rounded-2xl transition-all hover:border-emerald-300 hover:shadow-lg hover:shadow-slate-100"
                                >
                                    <div className="flex items-center gap-4 mb-4 md:mb-0">
                                        <div className="w-14 h-14 rounded-xl bg-slate-100 flex items-center justify-center text-2xl overflow-hidden border border-slate-200 shadow-inner">
                                            <img src={getFlagUrl(s.country)} alt="" className="w-full h-full object-cover opacity-90" />
                                        </div>
                                        <div>
                                            <div className="text-lg font-black text-slate-800 uppercase leading-none mb-1.5">{s.country}</div>
                                            <div className="flex gap-3 text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                                                <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">Tour {s.turn}</span>
                                                <span className="py-0.5">{s.date}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button 
                                          onClick={() => loadGameById(s.id)} 
                                          className="flex-1 md:flex-none px-6 py-2 bg-slate-900 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl transition-all shadow-md uppercase tracking-wide"
                                        >
                                          Charger
                                        </button>
                                        <button 
                                          onClick={() => deleteGame(s.id)} 
                                          className="w-9 flex items-center justify-center bg-white hover:bg-red-50 text-slate-400 hover:text-red-500 border border-slate-200 hover:border-red-200 rounded-xl transition-all"
                                          title="Supprimer"
                                        >
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

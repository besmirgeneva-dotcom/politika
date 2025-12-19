
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
        <div className="min-h-screen bg-stone-50 p-6 md:p-12 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-1/2 h-1/2 bg-blue-200/40 blur-[120px] rounded-full"></div>
            <div className="absolute bottom-0 left-0 w-1/3 h-1/3 bg-emerald-200/40 blur-[100px] rounded-full"></div>
            
            <div className="max-w-5xl mx-auto relative z-10">
                <div className="flex justify-between items-end mb-12 border-b border-stone-200 pb-8">
                  <div>
                      <h1 className="text-4xl md:text-5xl font-black text-stone-900 tracking-tighter uppercase mb-2">POLITIKA<span className="text-blue-600">_HUB</span></h1>
                      <p className="text-stone-500 font-mono text-xs uppercase tracking-[0.2em]">Terminal d'administration géopolitique v1.0.4</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                      <div className="flex items-center gap-3 bg-white p-2 rounded-xl border border-stone-200 shadow-sm">
                          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-xs">A</div>
                          <div className="hidden md:block">
                              <div className="text-[10px] text-stone-400 font-bold leading-none">AGENT CONNECTÉ</div>
                              <div className="text-xs text-stone-900 font-bold truncate max-w-[120px]">{user?.email}</div>
                          </div>
                          <button onClick={logout} className="p-2 hover:bg-red-50 text-stone-400 hover:text-red-500 rounded-lg transition-colors">
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
                          className="group relative flex-1 bg-white rounded-[2rem] border border-stone-200 p-8 cursor-pointer overflow-hidden transition-all hover:border-emerald-500 hover:shadow-xl hover:shadow-emerald-100"
                      >
                          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                              <span className="text-8xl grayscale group-hover:grayscale-0 transition-all">🌍</span>
                          </div>
                          <div className="relative z-10 h-full flex flex-col">
                              <div className="mb-auto">
                                  <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center mb-6 border border-emerald-200 group-hover:scale-110 transition-transform">
                                      <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                  </div>
                                  <h2 className="text-3xl font-black text-stone-900 leading-tight uppercase mb-4">NOUVELLE<br/>OPÉRATION</h2>
                                  <p className="text-stone-500 text-sm leading-relaxed">Initiez un nouveau scénario de domination mondiale. Choisissez votre nation et modelez l'histoire.</p>
                              </div>
                              <div className="mt-8">
                                  <div className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 group-hover:bg-emerald-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-200">
                                      LANCER LE PROTOCOLE
                                      <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                                  </div>
                              </div>
                          </div>
                      </div>
                    </div>

                    {/* Sauvegardes List */}
                    <div className="lg:col-span-2 bg-white/60 backdrop-blur-sm rounded-[2.5rem] border border-stone-200 p-8 flex flex-col shadow-lg shadow-stone-100">
                        <div className="flex items-center justify-between mb-8">
                          <h2 className="text-xl font-bold text-stone-900 flex items-center gap-3">
                              <span className="p-2 bg-stone-100 rounded-lg text-stone-500">
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
                              </span>
                              ARCHIVES DISPONIBLES
                          </h2>
                          <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">{availableSaves.length} slots utilisés</span>
                        </div>

                        <div className="flex-1 space-y-3 overflow-y-auto max-h-[400px] pr-2 scrollbar-hide">
                            {availableSaves.length === 0 ? (
                              <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-stone-200 rounded-3xl p-12 text-center opacity-60">
                                  <div className="text-4xl mb-4 grayscale opacity-50">💾</div>
                                  <p className="text-stone-400 text-sm font-bold uppercase tracking-widest">Aucune donnée archivée</p>
                              </div>
                            ) : availableSaves.map(s => (
                                <div 
                                  key={s.id} 
                                  className="group flex flex-col md:flex-row md:items-center justify-between p-5 bg-white border border-stone-100 rounded-2xl transition-all hover:border-blue-200 hover:shadow-lg hover:shadow-blue-50"
                                >
                                    <div className="flex items-center gap-4 mb-4 md:mb-0">
                                        <div className="w-12 h-12 rounded-xl bg-stone-100 flex items-center justify-center text-2xl overflow-hidden border border-stone-200 group-hover:border-blue-200 transition-colors">
                                            <img src={getFlagUrl(s.country)} alt="" className="w-full h-full object-cover" />
                                        </div>
                                        <div>
                                            <div className="text-lg font-black text-stone-900 uppercase leading-none mb-1">{s.country}</div>
                                            <div className="flex gap-3 text-[10px] font-bold text-stone-400 uppercase tracking-tighter">
                                                <span>Tour {s.turn}</span>
                                                <span>•</span>
                                                <span>{s.date}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button 
                                          onClick={() => loadGameById(s.id)} 
                                          className="flex-1 md:flex-none px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black rounded-xl transition-all shadow-md shadow-blue-100 uppercase"
                                        >
                                          Charger
                                        </button>
                                        <button 
                                          onClick={() => deleteGame(s.id)} 
                                          className="p-2.5 bg-white hover:bg-red-50 text-stone-400 hover:text-red-500 border border-stone-200 hover:border-red-200 rounded-xl transition-all"
                                          title="Supprimer la sauvegarde"
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

/**
 * StateJ - Sistema de Gerenciamento de Estado para Componentes Web
 * @version 1.0.0
 */
(function () {
  // Previne múltiplas inicializações
  if (window.StateJ) {
    console.log('StateJ já está carregado');
    return;
  }

  /**
   * @typedef {Object} StateJConfig
   * @property {string} [language='pt'] - Default language for translations
   * @property {Object} [translations={}] - Translation key-value pairs
   * @property {boolean} [cookieStorage=false] - Enable cookie storage
   * @property {boolean} [debug=false] - Enable debug mode
   * @property {number} [maxHistoryLength=50] - Max history length
   * @property {'local'|'session'} [storageType='session'] - Storage type
   * @property {string} [storageKey='statej_storage'] - Storage key
   * @property {Function} [errorHandler] - Custom error handler
   * @property {boolean} [useGlobalState=false] - Enable global state
   * @property {string[]} [globalStateKeys=[]] - Global state keys to watch
   */

  class StateJ {
    // Propriedades Estáticas
    static instance = null;
    static globalState = JSON.parse(localStorage.getItem('globalState')) || {};
    static listeners = new Set();
    static changeListeners = new Map();
    static debug = false;

    // Métodos Estáticos Utilitários
    static generateInstanceId() {
      return 'id_' + Date.now().toString(36) + Math.random().toString(36).substring(2);
    }

    static log(...args) {
      if (StateJ.debug) {
        console.log('[StateJ]', ...args);
      }
    }

    static error(...args) {
      if (StateJ.debug) {
        console.error('[StateJ Error]', ...args);
      }
    }

    // Métodos Estáticos de Estado Global
    static notifyListeners() {
      StateJ.listeners.forEach(listener => {
        if (typeof listener === 'function') {
          try {
            listener(StateJ.globalState);
          } catch (error) {
            StateJ.error('Erro ao notificar listener:', error);
          }
        }
      });
    }

    static setGlobalDebug(enabled) {
      StateJ.debug = enabled;
      StateJ.log('Debug mode:', enabled);
    }

    // Construtor
    constructor(config = {}) {
      this.instanceId = StateJ.generateInstanceId();
      this.eventHandlers = {};  // Mudado para objeto em vez de Map
      this.handlerCount = 0;
      // Configuração padrão
      this.config = {
        language: 'pt',
        translations: {},
        cookieStorage: false,
        debug: false,
        maxHistoryLength: 50,
        storageType: 'session',
        storageKey: `statej_storage_${this.instanceId}`,
        errorHandler: this.defaultErrorHandler.bind(this),
        useGlobalState: false,
        globalStateKeys: [],
        ...config
      };

      // Propriedades de estado
      this.state = {};
      this.stateHistory = [];
      this.container = null;
      this._updateFunction = null;

      // Inicialização
      this.setupStorage();

      if (this.config.useGlobalState) {
        this.subscribeToGlobalState();
      }

      if (this.config.debug) {
        StateJ.setGlobalDebug(true);
      }

      StateJ.log('Nova instância criada:', this.instanceId);
    }

    processEvents() {
      if (!this.container) return;

      // Procura por todos elementos com atributos de evento
      this.container.querySelectorAll('*').forEach(element => {
        const attributes = element.attributes;
        Array.from(attributes).forEach(attr => {
          if (attr.name.startsWith('on')) {
            const eventName = attr.name.toLowerCase();
            const handlerId = attr.value;

            // Remove antigos listeners para evitar duplicação
            if (element._stateJ_listeners) {
              element._stateJ_listeners.forEach(([evt, func]) => {
                element.removeEventListener(evt, func);
              });
            }

            // Adiciona novo listener
            element._stateJ_listeners = element._stateJ_listeners || [];
            const handler = this.eventHandlers.get(handlerId);

            if (handler) {
              const listener = (e) => {
                if (eventName === 'onchange') {
                  handler(e.target.value, e);
                } else if (eventName === 'onsubmit') {
                  e.preventDefault();
                  handler(e);
                } else {
                  handler(e);
                }
              };

              element.addEventListener(eventName.slice(2), listener);
              element._stateJ_listeners.push([eventName.slice(2), listener]);
            }
          }
        });
      });
    }

    generateHandlerId() {
      return `handler_${Math.random().toString(36).slice(2)}`;
    }
    registerHandler(handler) {
      const id = `handler_${this.handlerCount++}`;
      this.eventHandlers[id] = handler;
      return `return window.StateJ.handleEvent('${this.instanceId}', '${id}', event)`;
    }

    static handleEvent(instanceId, handlerId, event) {
      const instances = document.querySelectorAll('[data-statej-id]');
      for (let element of instances) {
        const instance = element._stateJ;
        if (instance && instance.instanceId === instanceId) {
          const handler = instance.eventHandlers[handlerId];
          if (handler) {
            if (event.type === 'change') {
              handler(event.target.value, event);
            } else if (event.type === 'submit') {
              event.preventDefault();
              handler(event);
            } else {
              handler(event);
            }
          }
          break;
        }
      }
      return false; // Previne comportamento padrão para links
    }

    // Métodos de Inicialização
    setupStorage() {
      const type = this.config.storageType.toLowerCase();
      this.storage = type === 'local' ? localStorage : sessionStorage;
    }

    // Manipulação de Estado Local
    setState(newState, options = { silent: false }) {
      try {
        const prevState = { ...this.state };

        // Gerencia histórico
        if (this.stateHistory.length >= this.config.maxHistoryLength) {
          this.stateHistory.shift();
        }
        this.stateHistory.push(prevState);

        // Atualiza estado
        Object.assign(this.state, newState);

        if (!options.silent) {
          this.render();
        }

        this.persistState();
        StateJ.log('Estado atualizado:', this.state);
      } catch (error) {
        StateJ.error('Erro ao atualizar estado:', error);
        throw error;
      }
    }

    getState(key) {
      return key ? this.state[key] : this.state;
    }

    // Manipulação de Estado Global
    setGlobalState(key, value) {
      if (!key) {
        throw new Error('Key é obrigatória para estado global');
      }

      StateJ.globalState[key] = value;
      localStorage.setItem('globalState', JSON.stringify(StateJ.globalState));
      StateJ.notifyListeners();
      StateJ.log('Estado global atualizado:', key, value);
    }

    getGlobalState(key) {
      return StateJ.globalState[key];
    }

    // Métodos de Ciclo de Vida
    subscribeToGlobalState() {
      this._updateFunction = () => {
        if (this.container) {
          this.render();
        }
      };
      StateJ.listeners.add(this._updateFunction);
      StateJ.log('Inscrito no estado global:', this.instanceId);
    }

    mount(selector) {
      this.container = document.querySelector(selector);
      if (!this.container) {
        throw new Error(`Element with selector ${selector} not found`);
      }

      // Adiciona identificador da instância
      this.container.setAttribute('data-statej-id', this.instanceId);
      this.container._stateJ = this;

      this.render();

      if (typeof this.componentDidMount === 'function') {
        this.componentDidMount();
      }
    }
    render() {
      if (this.container) {
        try {
          const content = this.renderComponent();
          if (content !== undefined) {
            this.container.innerHTML = content;
            if (typeof this.componentDidMount === 'function') {
              this.componentDidMount();
            }
          }
        } catch (error) {
          console.error('Erro ao renderizar:', error);
        }
      }
    }

    renderComponent() {
      return '';
    }

    // Persistência
    persistState() {
      try {
        const data = {
          state: this.state,
          timestamp: Date.now()
        };
        this.storage.setItem(this.config.storageKey, JSON.stringify(data));
      } catch (error) {
        StateJ.error('Erro ao persistir estado:', error);
      }
    }

    loadPersistedState() {
      try {
        const saved = this.storage.getItem(this.config.storageKey);
        if (saved) {
          const { state } = JSON.parse(saved);
          this.state = state || {};
        }
      } catch (error) {
        StateJ.error('Erro ao carregar estado persistido:', error);
      }
    }

    // Utilitários
    defaultErrorHandler(error, context) {
      StateJ.error(context, error);
      throw error;
    }

    // Limpeza
    destroy() {
      if (this.container) {
        this.container.removeAttribute('data-statej-id');
        delete this.container._stateJ;
      }
      if (this._updateFunction) {
        StateJ.listeners.delete(this._updateFunction);
      }

      this.persistState();
      this.container = null;
      this._updateFunction = null;

      StateJ.log('Componente destruído:', this.instanceId);
    }
  }

  // Expõe a classe globalmente
  window.StateJ = StateJ;

}());

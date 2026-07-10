import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and also handles the platform-specific web/native bootstrapping in one call.
registerRootComponent(App);

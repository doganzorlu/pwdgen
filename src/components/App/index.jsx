import './App.scss';
import {
  createTheme,
  StyledEngineProvider,
  ThemeProvider,
} from '@mui/material/styles';
import React, { Component } from 'react';
import classifyCharacter from 'util/classifyCharacter';
import Options from 'components/Options';
import PasswordGenerator from 'components/PasswordGenerator';
import removeDuplicateCharacters from 'util/removeDuplicateCharacters';

/**
 * Our custom theme override for Material-UI.
 */
const theme = createTheme({
  palette: {
    primary: {
      main: '#20BF55',
    },
  },
  typography: {
    fontFamily: '"Open Sans", sans-serif',
  },
});

/**
 * The main root component of the app.
 */
export default class App extends Component {
  constructor() {
    super();
    this.state = {
      options: {
        passwordLength: 9,
        minDigitProportion: 0.01,
        minSymbolProportion: 0.01,
        maxCaseVariance: 0.01,
        useLowercase: true,
        useUppercase: true,
        useDigits: true,
        useSymbols: true,
        symbols: '!@#$%&*_?',
      },
    };
  }

  /**
   * Updates the current set of password generation options. A partial options object can
   * be provided, which will only update the given options.
   */
  onOptionsChange(optionsDelta) {
    this.setState((prevState) => {
      // Get the entire new set of options
      const currentOptions = prevState.options;
      const newOptions = {
        ...currentOptions,
        ...optionsDelta,
      };
      // Remove duplicate symbols
      newOptions.symbols = removeDuplicateCharacters(newOptions.symbols);
      // Don't allow the options to be changed if it would result in less than 2
      // characters being used for password generation, if less than 1 symbol is
      // provided, or if invalid symbols are provided
      let hasValidSymbols = true;
      for (
        let i = 0;
        hasValidSymbols && i < newOptions.symbols.length;
        i += 1
      ) {
        hasValidSymbols = hasValidSymbols
          && classifyCharacter(newOptions.symbols.charCodeAt(i)) === 'symbol';
      }
      if (
        (newOptions.useUppercase
          || newOptions.useLowercase
          || newOptions.useDigits
          || (newOptions.useSymbols && newOptions.symbols.length > 1))
        && hasValidSymbols
        && newOptions.symbols.length > 0
      ) {
        return {
          options: newOptions,
        };
      }
      return {
        options: currentOptions,
      };
    });
  }

  render() {
    const { options } = this.state;
    return (
      <StyledEngineProvider injectFirst>
        <ThemeProvider theme={theme}>
          <div className="app-container">
            <h1>Password Generator</h1>
            <PasswordGenerator options={options} />
            <h2>Options</h2>
            <Options
              options={options}
              onOptionsChange={(newOptions) => this.onOptionsChange(newOptions)}
            />
          </div>
        </ThemeProvider>
      </StyledEngineProvider>
    );
  }
}

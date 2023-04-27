/* eslint no-restricted-globals: 0 */
/* eslint no-await-in-loop: 0 */
// eslint-disable-next-line spaced-comment
/// <reference path="PasswordGeneratorUtil.js" />

import classifyCharacter from 'util/classifyCharacter';

/**
 * Stores previously randomly generated bytes. Used to buffer 'REQUEST_GET_RANDOM_BYTES' calls to
 * the main thread for performance.
 */
const randomPool = {
  // Cache around 64KiB of random data
  buffer: new Uint8Array(65536),
  // Number of bytes read from the buffer so far (initially max to trigger a call to
  // regenerateRandomPool())
  numRead: 65536,
  // The current promise to regenerateRandomPool(), or null if the buffer is not currently being
  // regenerated
  regenerationPromise: null,
};

/**
 * Regenerates the buffer of cached random bytes by fetching some new cryptographically secure
 * random bytes from the main thread. Returns a promise that resolves when this is complete, or
 * rejects if an error occurred.
 */
function regenerateRandomPool() {
  // Only continue if another regeneration of the buffer isn't already in progress
  if (randomPool.regenerationPromise === null) {
    randomPool.regenerationPromise = new Promise((resolve, reject) => {
      // Add a message handler for when the random bytes are ready from the main thread
      const onMessageListener = (event) => {
        switch (event.data.messageType) {
          case 'RESPONSE_GET_RANDOM_BYTES': {
            // Remove this message handler now that we have the random bytes and resolve the promise
            self.removeEventListener('message', onMessageListener);
            randomPool.buffer = new Uint8Array(event.data.messageData.buffer);
            randomPool.numRead = 0;
            randomPool.regenerationPromise = null;
            if (event.data.responseCode === 'OK') {
              resolve();
            } else {
              reject(new Error(event.data.messageData.message));
            }
            break;
          }
          default:
            break;
        }
      };
      self.addEventListener('message', onMessageListener);
      // Let the main thread know we need more random bytes
      self.postMessage(
        {
          messageType: 'REQUEST_GET_RANDOM_BYTES',
          messageData: {
            buffer: randomPool.buffer.buffer,
          },
        },
        [randomPool.buffer.buffer],
      );
    });
  }
  return randomPool.regenerationPromise;
}

/**
 * Returns a cryptographically secure random byte, which may need to wait for regenerateRandomPool()
 * if the cache of random bytes is empty.
 *
 * @returns {number} A random number in the range [0, 255] inclusive.
 * @throws {Error} An error occurred while generating random bytes.
 */
async function getRandomByte() {
  // Check if we've run out of random bytes, and regenerate the random buffer if we have
  if (randomPool.numRead >= randomPool.buffer.length) {
    await regenerateRandomPool();
  }
  // Need to check again after regenerating the random buffer to avoid a rare race condition where
  // another call to getRandomByte() would try to read past the end of the buffer.
  if (randomPool.numRead < randomPool.buffer.length) {
    const randomByte = randomPool.buffer[randomPool.numRead];
    randomPool.numRead += 1;
    return randomByte;
  }
  // If the random buffer has run out of bytes since the await call above, then we need to
  // recursively try again until we manage to get a byte.
  return getRandomByte();
}

/**
 * Generates a cryptographically secure random byte in the given range. All random numbers returned
 * are uniform in distribution, using an algorithm similar to OpenJDK's Random.nextInt() method to
 * ensure uniformity.
 *
 * @param {number} min The inclusive lower bound of the range, between 0 and 255 inclusive.
 * @param {number} max The inclusive upper bound of the range, between 0 and 255 inclusive, and
 *                     greater than min.
 * @returns {number} A random number in the range [min, max] inclusive.
 * @throws {Error} An error occurred while generating random bytes.
 */
async function getRandomByteInRange(min, max) {
  const bound = max - min + 1;
  let randomUint8 = 0;
  do {
    randomUint8 = await getRandomByte();
  } while (randomUint8 > Math.floor((0xff + 1) / bound) * bound - 1);
  return (randomUint8 % bound) + min;
}

/**
 * Determines if the given randomly generated password is valid according to the provided password
 * generation options.
 *
 * @param {string} password The password to validate.
 * @param {PasswordGenerationOptions} options The options describing the characteristics that the
 *                                            password must have.
 * @returns {boolean} true if the password meets the requirements specified in the given options,
 *                    and false otherwise.
 */
function passwordIsValid(password, options) {
  // Count the number of characters that fall into each classification
  const characterCount = new Map();
  for (let i = 0; i < password.length; i += 1) {
    const currentCharClassification = classifyCharacter(password.charCodeAt(i));
    if (!characterCount.has(currentCharClassification)) {
      characterCount.set(currentCharClassification, 1);
    } else {
      characterCount.set(
        currentCharClassification,
        characterCount.get(currentCharClassification) + 1,
      );
    }
  }
  // Determine if the password conforms to the given options
  const digits = characterCount.get('digit') || 0;
  const symbols = characterCount.get('symbol') || 0;
  const lowercase = characterCount.get('lowercase') || 0;
  const uppercase = characterCount.get('uppercase') || 0;
  const letters = lowercase + uppercase;
  return (
    (!options.useDigits || digits / password.length >= options.minDigitProportion)
    && (
      !(options.useSymbols && options.symbols.length > 0)
      || symbols / password.length >= options.minSymbolProportion
    )
    && (
      !(letters > 0 && options.useUppercase && options.useLowercase)
      || 2 * Math.abs(lowercase / letters - 0.5) <= options.maxCaseVariance
    )
  );
}

/**
 * Generates a cryptographically secure random string of the given length using the given
 * characters.
 *
 * @param {number} length The length of the random string to generate.
 * @param {string} characters The characters to build the random string from. Each character has an
 *                            equal probability of being selected.
 * @returns {string} A random string of the given length made using the given characters.
 * @throws {Error} An error occurred while generating random bytes.
 */
async function generateRandomString(length, characters) {
  let randomString = '';
  for (let i = 0; i < length; i += 1) {
    randomString += characters[await getRandomByteInRange(0, characters.length - 1)];
  }
  return randomString;
}

/**
 * Generates a cryptographically secure random password that has the characteristics specified in
 * the given options.
 *
 * @param {PasswordGenerationOptions} options The options describing the characteristics of the
 *                                            password to generate.
 * @param {number} timeout The maximum amount of time in seconds to wait before giving up generating
 *                         the password.
 * @returns {string|null} The generated password, or null if the given timeout expired.
 * @throws {Error} An error occurred while generating random bytes.
 */
async function generatePassword(options, timeout) {
  // Measure the starting time
  const startTime = Date.now();

  // Determine what characters to use
  let passwordChars = '';
  if (options.useUppercase) {
    passwordChars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  }
  if (options.useLowercase) {
    passwordChars += 'abcdefghijklmnopqrstuvwxyz';
  }
  if (options.useDigits) {
    passwordChars += '0123456789';
  }
  if (options.useSymbols) {
    passwordChars += options.symbols;
  }

  // Try to generate passwords until we get one that satisfies the given options
  let password = '';
  do {
    password = await generateRandomString(
      options.passwordLength,
      passwordChars,
    );

    // Check if we've been running for too long
    if (Date.now() - startTime >= timeout * 1000) {
      return null;
    }
  } while (!passwordIsValid(password, options));
  return password;
}

// Handle messages from the main thread to generate passwords
self.addEventListener('message', async (event) => {
  switch (event.data.messageType) {
    case 'REQUEST_GENERATE_PASSWORD': {
      try {
        // Try generating the password, communicating back to the main thread whether the password
        // was generated, a timeout occurred, or an error occurred.
        const password = await generatePassword(
          event.data.messageData.options,
          event.data.messageData.timeout,
        );
        if (password !== null) {
          self.postMessage({
            messageType: 'RESPONSE_GENERATE_PASSWORD',
            responseCode: 'OK',
            messageData: {
              password,
            },
          });
        } else {
          self.postMessage({
            messageType: 'RESPONSE_GENERATE_PASSWORD',
            responseCode: 'TIMEOUT',
          });
        }
      } catch (error) {
        self.postMessage({
          messageType: 'RESPONSE_GENERATE_PASSWORD',
          responseCode: 'ERROR',
          messageData: {
            message: error.message,
          },
        });
      }
      break;
    }
    default:
      break;
  }
});

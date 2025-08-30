// NOTE: react-native-nfc-passport-reader library is listed in package.json but not installed
// You may need to run 'npm install' or 'yarn install' to install the library
import { Platform } from 'react-native';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';

// Define types for our data
interface MrzInfo {
  documentNumber: string;
  dateOfBirth: string;
  dateOfExpiry: string;
}

interface BacKey {
  Kenc: string;
  Kmac: string;
}

interface PassportData {
  firstName: string;
  lastName: string;
  passportNumber: string;
  nationality: string;
  dateOfBirth: string;
  dateOfExpiry: string;
  gender: string;
  issuingCountry: string;
  // Add more fields as needed
}

/**
 * Initializes NFC manager
 */
export const initializeNfc = async (): Promise<boolean> => {
  try {
    await NfcManager.start();
    console.log('NFC initialized successfully');
    return true;
  } catch (error) {
    console.error('Failed to initialize NFC:', error);
    return false;
  }
};

/**
 * Checks if NFC is supported on the device
 */
export const isNfcSupported = async (): Promise<boolean> => {
  try {
    return await NfcManager.isSupported();
  } catch (error) {
    console.error('Failed to check NFC support:', error);
    return false;
  }
};

/**
 * Reads passport data using BAC keys
 * @param mrzInfo MRZ information from the passport
 * @param bacKey BAC keys generated from MRZ data
 * @returns Passport data or null if reading failed
 */
export const readPassportWithBac = async (
  mrzInfo: MrzInfo,
  bacKey: BacKey
): Promise<PassportData | null> => {
  try {
    console.log('Starting passport read with BAC');
    console.log('MRZ Info:', mrzInfo);
    console.log('BAC Keys:', bacKey);
    
    // Request NFC technology for ISO 14443-4 (passport)
    await NfcManager.requestTechnology(NfcTech.IsoDep);
    
    // Get the tag
    const tag = await NfcManager.getTag();
    console.log('Tag found', tag);
    
    // TODO: Implement actual BAC protocol with the keys
    // This would involve:
    // 1. Selecting the passport application
    // 2. Performing BAC authentication with the Kenc and Kmac keys
    // 3. Reading data groups from the passport
    //
    // For a production implementation, you would need to:
    // - Implement the full BAC protocol for authentication
    // - Read data groups (DG1, DG2, etc.) from the passport
    // - Parse the data according to ICAO 9303 standard
    // - Handle secure messaging (DES/3DES encryption)
    // - Construct APDU commands for communication with the passport
    
    // Cancel the technology request
    NfcManager.cancelTechnologyRequest();
    
    // For now, we'll just simulate reading some data
    // In a real implementation, you would use the BAC keys to authenticate
    // and then read the actual passport data
    const passportData: PassportData = {
      firstName: "John",
      lastName: "Doe",
      passportNumber: mrzInfo.documentNumber,
      nationality: "USA",
      dateOfBirth: mrzInfo.dateOfBirth,
      dateOfExpiry: mrzInfo.dateOfExpiry,
      gender: "M",
      issuingCountry: "USA",
    };
    
    return passportData;
  } catch (error) {
    console.error('Error reading passport with BAC:', error);
    // Try to get more detailed error information
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    // Cancel the technology request in case of error
    try {
      NfcManager.cancelTechnologyRequest();
    } catch (cancelError) {
      console.warn('Failed to cancel NFC technology request:', cancelError);
    }
    return null;
  }
};

/**
 * Reads passport data using only MRZ information (without BAC)
 * This is less secure and may not work with all passports
 * @param mrzInfo MRZ information from the passport
 * @returns Passport data or null if reading failed
 */
export const readPassportWithoutBac = async (
  mrzInfo: MrzInfo
): Promise<PassportData | null> => {
  try {
    console.log('Starting passport read without BAC');
    console.log('MRZ Info:', mrzInfo);
    
    // Request NFC technology for ISO 14443-4 (passport)
    await NfcManager.requestTechnology(NfcTech.IsoDep);
    
    // Get the tag
    const tag = await NfcManager.getTag();
    console.log('Tag found', tag);
    
    // TODO: Implement reading passport data without BAC
    // This is less secure and may not work with all passports
    
    // Cancel the technology request
    NfcManager.cancelTechnologyRequest();
    
    // For now, we'll just simulate reading some data
    const passportData: PassportData = {
      firstName: "John",
      lastName: "Doe",
      passportNumber: mrzInfo.documentNumber,
      nationality: "USA",
      dateOfBirth: mrzInfo.dateOfBirth,
      dateOfExpiry: mrzInfo.dateOfExpiry,
      gender: "M",
      issuingCountry: "USA",
    };
    
    return passportData;
  } catch (error) {
    console.error('Error reading passport without BAC:', error);
    // Try to get more detailed error information
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    // Cancel the technology request in case of error
    try {
      NfcManager.cancelTechnologyRequest();
    } catch (cancelError) {
      console.warn('Failed to cancel NFC technology request:', cancelError);
    }
    return null;
  }
};

/**
 * Gets NFC availability status
 * @returns Object with NFC availability information
 */
export const getNfcStatus = async () => {
  try {
    const supported = await isNfcSupported();
    const enabled = await NfcManager.isEnabled();
    
    return {
      supported,
      enabled: supported && enabled,
      message: supported
        ? enabled
          ? 'NFC is supported and enabled'
          : 'NFC is supported but disabled'
        : 'NFC is not supported on this device'
    };
  } catch (error) {
    console.error('Error getting NFC status:', error);
    return {
      supported: false,
      enabled: false,
      message: 'Error checking NFC status'
    };
  }
};

export default {
  initializeNfc,
  isNfcSupported,
  readPassportWithBac,
  readPassportWithoutBac,
  getNfcStatus,
};
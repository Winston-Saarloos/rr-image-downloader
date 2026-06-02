import * as fs from 'fs-extra';
import {
  describeOutputConfigurationError,
  isOutputRootAccessible,
} from '../recnet-service';

jest.mock('fs-extra', () => {
  const actualFs = jest.requireActual('fs-extra');
  return {
    ...actualFs,
    pathExistsSync: jest.fn(),
  };
});

const mockedFs = fs as jest.Mocked<typeof fs>;

describe('RecNetService output path availability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('treats missing drive roots as inaccessible', () => {
    (mockedFs.pathExistsSync as jest.Mock).mockReturnValue(false);
    expect(isOutputRootAccessible('I:\\Rec Room User Images')).toBe(false);
  });

  it('treats existing folders as accessible', () => {
    const folder = 'C:\\Photos\\Library';
    (mockedFs.pathExistsSync as jest.Mock).mockImplementation(
      (target: string) => target === folder
    );
    expect(isOutputRootAccessible(folder)).toBe(true);
  });

  it('treats new folders under an existing parent as accessible', () => {
    const parent = 'C:\\Photos';
    const folder = 'C:\\Photos\\NewLibrary';
    (mockedFs.pathExistsSync as jest.Mock).mockImplementation(
      (target: string) => target === parent
    );
    expect(isOutputRootAccessible(folder)).toBe(true);
  });

  it('describes unavailable configured paths as a configuration error', () => {
    (mockedFs.pathExistsSync as jest.Mock).mockReturnValue(false);
    expect(
      describeOutputConfigurationError({
        outputRoot: 'I:\\Rec Room User Images',
      })
    ).toMatch(/not available/i);
  });
});

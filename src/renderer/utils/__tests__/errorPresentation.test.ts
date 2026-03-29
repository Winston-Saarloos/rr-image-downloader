import {
  classifyError,
  createUserIncident,
} from '../errorPresentation';

describe('errorPresentation', () => {
  it('classifies empty user photo downloads as a friendly warning state', () => {
    const result = classifyError(
      'This account does not have any user photos to download.',
      'download'
    );

    expect(result).toEqual({
      category: 'empty',
      title: 'No user photos found',
      detail: 'This account does not have any user photos to download.',
      guidance: [
        'You can still download other sections for this account.',
        'Try another account if you expected photos to be available here.',
      ],
    });
  });

  it('defaults empty download incidents to warning severity', () => {
    const incident = createUserIncident(
      'download',
      'This account does not have any feed photos to download.'
    );

    expect(incident.severity).toBe('warning');
    expect(incident.category).toBe('empty');
    expect(incident.title).toBe('No feed photos found');
    expect(incident.detail).toBe(
      'This account does not have any feed photos to download.'
    );
  });
});

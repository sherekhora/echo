const REC_LABEL = 'save animation';

function toggleRec() {
  if (recorder) { recorder.stop(); return; }

  userStartAudio();
  const stream = cnv.elt.captureStream(REC_FPS);

  // звук треку в той самий потік
  try {
    audioDest = getAudioContext().createMediaStreamDestination();
    snd.output.connect(audioDest);
    audioDest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  } catch (e) {
    console.log('звук у відео не додано:', e);
    audioDest = null;
  }

  const types = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  const type = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  recExt = type.indexOf('mp4') === 0 ? 'mp4' : 'webm';

  recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12000000 });
  chunks = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'contour.' + recExt;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);

    if (audioDest) { try { snd.output.disconnect(audioDest); } catch (e) {} audioDest = null; }
    recorder = null;
    ui.rec.html(REC_LABEL);
    ui.rec.removeClass('on');
  };

  recorder.start(250);
  recStart = millis();
  ui.rec.addClass('on');
  console.log('запис:', type || 'формат браузера за замовчуванням');
}

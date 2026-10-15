package objects

import (
	"bytes"
	"context"
	"errors"
	"net/url"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/onlyjah/ark/backend/internal/model"
)

type S3 struct {
	client *s3.Client
	bucket string
}

func NewS3(endpoint, region, bucket, key, secret string) (*S3, error) {
	u, e := url.Parse(endpoint)
	if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || bucket == "" || region == "" || key == "" || secret == "" {
		return nil, errors.New("complete HTTPS S3 configuration required")
	}
	// Some S3-compatible endpoints do not implement AWS's optional checksum
	// trailers. The API independently reads back and hashes every upload.
	client := s3.New(s3.Options{Region: region, BaseEndpoint: aws.String(endpoint), UsePathStyle: true, RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired, Credentials: credentials.NewStaticCredentialsProvider(key, secret, "")})
	return &S3{client: client, bucket: bucket}, nil
}
func (s *S3) Kind() string { return "s3-compatible" }
func (s *S3) Put(ctx context.Context, owner, digest string, b []byte) error {
	if !digestPattern.MatchString(digest) || model.Digest(b) != digest {
		return errors.New("digest mismatch")
	}
	_, e := s.client.PutObject(ctx, &s3.PutObjectInput{Bucket: &s.bucket, Key: aws.String(model.ObjectKey(owner, digest)), Body: bytes.NewReader(b), ContentType: aws.String("application/octet-stream")})
	return e
}
func (s *S3) Get(ctx context.Context, owner, digest string) ([]byte, error) {
	if !digestPattern.MatchString(digest) {
		return nil, errors.New("invalid digest")
	}
	r, e := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: &s.bucket, Key: aws.String(model.ObjectKey(owner, digest))})
	if e != nil {
		return nil, e
	}
	defer r.Body.Close()
	return ReadVerified(r.Body, digest)
}
